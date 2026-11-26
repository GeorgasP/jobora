"""
Places: countries, their main job markets, the regions they belong to, and the
words job ads use for all of them. The Python twin of extension/lib/places.js:
the matcher asks whether a job's location names a place the user wants, and
whether a remote job is open to where the user is.

Words are matched whole after folding (lower case, no accents); a term ending
in "*" matches any word starting with it, for Greek cases (Αθήνα, Αθήνας).
Two-letter codes count only in capitals or as the last part of a location.

The tables below are the same as in places.js (tests/test_places.py checks
that they stay so); change both together.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache

# ── Regions, countries and the words ads use for them (as in places.js) ──

REGIONS = {
  "eu": ["eu", "european union", "eea", "schengen"],
  "europe": ["europe", "european", "cet", "cest", "eet"],
  "emea": ["emea"],
  "north america": ["north america"],
  "americas": ["americas"],
  "latam": ["latam", "latin america", "south america", "central america"],
  "apac": ["apac", "asia", "asia pacific"],
  "mena": ["mena", "middle east", "gcc"],
  "africa": ["africa"],
  "oceania": ["oceania", "anz"],
}

EU = ["eu", "europe", "emea"]
EUROPE = ["europe", "emea"]
NORTH_AMERICA = ["north america", "americas"]
LATAM = ["americas", "latam"]
APAC = ["apac"]
MENA = ["mena", "emea"]
AFRICA = ["africa", "emea"]

COUNTRIES = {
  "greece": { "label": "Greece", "code": "GR", "regions": EU,
    "names": ["greece", "hellas", "ellada", "ελλαδα", "ελλας"],
    "cities": [["athens", "athina", "αθην*", "attica", "attiki", "αττικ*"], ["thessaloniki", "θεσσαλονικ*"],
      ["piraeus", "πειραι*"], ["patras", "πατρα*"], ["heraklion", "iraklio", "ηρακλει*"],
      ["larissa", "λαρισ*"], ["ioannina", "ιωαννιν*"], ["chania", "χανι*"]] },
  "cyprus": { "label": "Cyprus", "code": "CY", "regions": EU, "names": ["cyprus", "κυπρο*"],
    "cities": [["nicosia", "λευκωσι*"], ["limassol", "λεμεσ*"], ["larnaca", "λαρνακ*"], ["paphos", "παφο*"]] },
  "germany": { "label": "Germany", "code": "DE", "regions": EU,
    "names": ["germany", "deutschland", "allemagne", "alemania", "germania", "niemcy"],
    "cities": [["berlin"], ["munich", "munchen"], ["hamburg"], ["frankfurt"], ["cologne", "koln"],
      ["stuttgart"], ["dusseldorf"], ["leipzig"], ["dresden"], ["hannover", "hanover"],
      ["nuremberg", "nurnberg"], ["bremen"], ["essen"], ["dortmund"], ["karlsruhe"], ["mannheim"]] },
  "austria": { "label": "Austria", "code": "AT", "regions": EU, "names": ["austria", "osterreich"],
    "cities": [["vienna", "wien"], ["graz"], ["linz"], ["salzburg"], ["innsbruck"]] },
  "switzerland": { "label": "Switzerland", "code": "CH", "regions": EUROPE,
    "names": ["switzerland", "schweiz", "suisse", "svizzera"],
    "cities": [["zurich"], ["geneva", "geneve", "genf"], ["basel"], ["bern"], ["lausanne"], ["lugano"], ["zug"]] },
  "france": { "label": "France", "code": "FR", "regions": EU, "names": ["france", "frankreich", "francia"],
    "cities": [["paris"], ["lyon"], ["marseille"], ["toulouse"], ["lille"], ["bordeaux"], ["nantes"], ["nice"]] },
  "belgium": { "label": "Belgium", "code": "BE", "regions": EU, "names": ["belgium", "belgique", "belgie"],
    "cities": [["brussels", "bruxelles", "brussel"], ["antwerp", "antwerpen"], ["ghent", "gent"]] },
  "netherlands": { "label": "Netherlands", "code": "NL", "regions": EU, "names": ["netherlands", "nederland", "holland"],
    "cities": [["amsterdam"], ["rotterdam"], ["utrecht"], ["eindhoven"], ["the hague", "den haag"]] },
  "luxembourg": { "label": "Luxembourg", "code": "LU", "regions": EU, "names": ["luxembourg", "luxemburg"], "cities": [] },
  "ireland": { "label": "Ireland", "code": "IE", "regions": EU, "names": ["ireland", "eire"],
    "cities": [["dublin"], ["cork"], ["galway"]] },
  "uk": { "label": "United Kingdom", "code": "GB", "regions": EUROPE,
    "names": ["united kingdom", "uk", "great britain", "britain", "england", "scotland", "wales", "northern ireland"],
    "cities": [["london"], ["manchester"], ["birmingham"], ["edinburgh"], ["glasgow"], ["bristol"], ["leeds"],
      ["cambridge"], ["oxford"], ["belfast"]] },
  "spain": { "label": "Spain", "code": "ES", "regions": EU, "names": ["spain", "espana", "espanya"],
    "cities": [["madrid"], ["barcelona"], ["valencia"], ["seville", "sevilla"], ["malaga"], ["bilbao"]] },
  "portugal": { "label": "Portugal", "code": "PT", "regions": EU, "names": ["portugal"],
    "cities": [["lisbon", "lisboa"], ["porto"]] },
  "italy": { "label": "Italy", "code": "IT", "regions": EU, "names": ["italy", "italia"],
    "cities": [["rome", "roma"], ["milan", "milano"], ["turin", "torino"], ["naples", "napoli"], ["bologna"],
      ["florence", "firenze"]] },
  "malta": { "label": "Malta", "code": "MT", "regions": EU, "names": ["malta"], "cities": [["valletta"]] },
  "poland": { "label": "Poland", "code": "PL", "regions": EU, "names": ["poland", "polska"],
    "cities": [["warsaw", "warszawa"], ["krakow"], ["wroclaw"], ["gdansk"], ["poznan"]] },
  "czechia": { "label": "Czechia", "code": "CZ", "regions": EU, "names": ["czechia", "czech republic", "cesko"],
    "cities": [["prague", "praha"], ["brno"]] },
  "slovakia": { "label": "Slovakia", "code": "SK", "regions": EU, "names": ["slovakia", "slovensko"], "cities": [["bratislava"]] },
  "hungary": { "label": "Hungary", "code": "HU", "regions": EU, "names": ["hungary", "magyarorszag"], "cities": [["budapest"]] },
  "romania": { "label": "Romania", "code": "RO", "regions": EU, "names": ["romania"],
    "cities": [["bucharest", "bucuresti"], ["cluj"], ["iasi"], ["timisoara"]] },
  "bulgaria": { "label": "Bulgaria", "code": "BG", "regions": EU, "names": ["bulgaria"],
    "cities": [["sofia"], ["plovdiv"], ["varna"]] },
  "croatia": { "label": "Croatia", "code": "HR", "regions": EU, "names": ["croatia", "hrvatska"], "cities": [["zagreb"]] },
  "slovenia": { "label": "Slovenia", "code": "SI", "regions": EU, "names": ["slovenia", "slovenija"], "cities": [["ljubljana"]] },
  "estonia": { "label": "Estonia", "code": "EE", "regions": EU, "names": ["estonia"], "cities": [["tallinn"]] },
  "latvia": { "label": "Latvia", "code": "LV", "regions": EU, "names": ["latvia"], "cities": [["riga"]] },
  "lithuania": { "label": "Lithuania", "code": "LT", "regions": EU, "names": ["lithuania"], "cities": [["vilnius"]] },
  "denmark": { "label": "Denmark", "code": "DK", "regions": EU, "names": ["denmark", "danmark"],
    "cities": [["copenhagen", "kobenhavn"], ["aarhus"]] },
  "sweden": { "label": "Sweden", "code": "SE", "regions": EU, "names": ["sweden", "sverige"],
    "cities": [["stockholm"], ["gothenburg", "goteborg"], ["malmo"]] },
  "finland": { "label": "Finland", "code": "FI", "regions": EU, "names": ["finland", "suomi"],
    "cities": [["helsinki"], ["espoo"], ["tampere"]] },
  # Not in the EU, but in the EEA: the same right to work as EU citizens.
  "norway": { "label": "Norway", "code": "NO", "regions": EU, "names": ["norway", "norge"], "cities": [["oslo"], ["bergen"]] },
  "iceland": { "label": "Iceland", "code": "IS", "regions": EU, "names": ["iceland"], "cities": [["reykjavik"]] },
  "serbia": { "label": "Serbia", "code": "RS", "regions": EUROPE, "names": ["serbia", "srbija"],
    "cities": [["belgrade", "beograd"], ["novi sad"]] },
  "ukraine": { "label": "Ukraine", "code": "UA", "regions": EUROPE, "names": ["ukraine", "ukraina"],
    "cities": [["kyiv", "kiev"], ["lviv"], ["kharkiv"]] },
  "turkey": { "label": "Turkey", "code": "TR", "regions": EUROPE, "names": ["turkey", "turkiye"],
    "cities": [["istanbul"], ["ankara"], ["izmir"]] },
  "albania": { "label": "Albania", "code": "AL", "regions": EUROPE, "names": ["albania"], "cities": [["tirana"]] },
  "north macedonia": { "label": "North Macedonia", "code": "MK", "regions": EUROPE, "names": ["north macedonia"],
    "cities": [["skopje"]] },
  "us": { "label": "United States", "code": "US", "regions": NORTH_AMERICA,
    "names": ["united states", "usa", "america", "california", "texas", "florida", "washington", "massachusetts",
      "illinois", "colorado", "virginia", "north carolina", "ohio", "michigan", "oregon", "arizona",
      "pennsylvania", "new jersey", "utah", "minnesota", "tennessee"],
    "cities": [["new york", "nyc", "brooklyn"], ["san francisco", "bay area"], ["los angeles"], ["seattle"],
      ["austin"], ["boston"], ["chicago"], ["denver"], ["atlanta"], ["miami"], ["dallas"], ["houston"],
      ["philadelphia"], ["phoenix"], ["san diego"], ["san jose"], ["portland"], ["salt lake city"],
      ["nashville"], ["pittsburgh"], ["detroit"], ["minneapolis"], ["raleigh"], ["menlo park"],
      ["palo alto"], ["mountain view"], ["sunnyvale"], ["bellevue"], ["redmond"], ["santa clara"],
      ["cupertino"]] },
  "canada": { "label": "Canada", "code": "CA", "regions": NORTH_AMERICA,
    "names": ["canada", "ontario", "quebec", "british columbia", "alberta", "nova scotia", "manitoba"],
    "cities": [["toronto"], ["vancouver"], ["montreal"], ["ottawa"], ["calgary"], ["edmonton"], ["waterloo"],
      ["winnipeg"]] },
  "mexico": { "label": "Mexico", "code": "MX", "regions": [*NORTH_AMERICA, "latam"], "names": ["mexico"],
    "cities": [["mexico city", "cdmx"], ["guadalajara"], ["monterrey"]] },
  "brazil": { "label": "Brazil", "code": "BR", "regions": LATAM, "names": ["brazil", "brasil"],
    "cities": [["sao paulo"], ["rio de janeiro"], ["belo horizonte"], ["curitiba"], ["porto alegre"],
      ["florianopolis"]] },
  "argentina": { "label": "Argentina", "code": "AR", "regions": LATAM, "names": ["argentina"], "cities": [["buenos aires"]] },
  "chile": { "label": "Chile", "code": "CL", "regions": LATAM, "names": ["chile"], "cities": [["santiago"]] },
  "colombia": { "label": "Colombia", "code": "CO", "regions": LATAM, "names": ["colombia"],
    "cities": [["bogota"], ["medellin"]] },
  "peru": { "label": "Peru", "code": "PE", "regions": LATAM, "names": ["peru"], "cities": [["lima"]] },
  "uruguay": { "label": "Uruguay", "code": "UY", "regions": LATAM, "names": ["uruguay"], "cities": [["montevideo"]] },
  "costa rica": { "label": "Costa Rica", "code": "CR", "regions": LATAM, "names": ["costa rica"], "cities": [] },
  "india": { "label": "India", "code": "IN", "regions": APAC, "names": ["india"],
    "cities": [["bangalore", "bengaluru"], ["mumbai"], ["delhi", "new delhi"], ["hyderabad"], ["pune"],
      ["chennai"], ["gurgaon", "gurugram"], ["noida"], ["kolkata"]] },
  "pakistan": { "label": "Pakistan", "code": "PK", "regions": APAC, "names": ["pakistan"],
    "cities": [["karachi"], ["lahore"], ["islamabad"]] },
  "singapore": { "label": "Singapore", "code": "SG", "regions": APAC, "names": ["singapore"], "cities": [] },
  "malaysia": { "label": "Malaysia", "code": "MY", "regions": APAC, "names": ["malaysia"], "cities": [["kuala lumpur"]] },
  "philippines": { "label": "Philippines", "code": "PH", "regions": APAC, "names": ["philippines"],
    "cities": [["manila"], ["makati"], ["cebu"]] },
  "indonesia": { "label": "Indonesia", "code": "ID", "regions": APAC, "names": ["indonesia"], "cities": [["jakarta"], ["bali"]] },
  "thailand": { "label": "Thailand", "code": "TH", "regions": APAC, "names": ["thailand"], "cities": [["bangkok"]] },
  "vietnam": { "label": "Vietnam", "code": "VN", "regions": APAC, "names": ["vietnam", "viet nam"],
    "cities": [["ho chi minh", "saigon"], ["hanoi"]] },
  "japan": { "label": "Japan", "code": "JP", "regions": APAC, "names": ["japan"], "cities": [["tokyo"], ["osaka"], ["kyoto"]] },
  "south korea": { "label": "South Korea", "code": "KR", "regions": APAC, "names": ["south korea", "korea"],
    "cities": [["seoul"], ["busan"]] },
  "china": { "label": "China", "code": "CN", "regions": APAC, "names": ["china"],
    "cities": [["beijing"], ["shanghai"], ["shenzhen"], ["guangzhou"], ["hangzhou"]] },
  "hong kong": { "label": "Hong Kong", "code": "HK", "regions": APAC, "names": ["hong kong"], "cities": [] },
  "taiwan": { "label": "Taiwan", "code": "TW", "regions": APAC, "names": ["taiwan"], "cities": [["taipei"]] },
  "australia": { "label": "Australia", "code": "AU", "regions": [*APAC, "oceania"], "names": ["australia"],
    "cities": [["sydney"], ["melbourne"], ["brisbane"], ["perth"], ["adelaide"], ["canberra"]] },
  "new zealand": { "label": "New Zealand", "code": "NZ", "regions": [*APAC, "oceania"], "names": ["new zealand"],
    "cities": [["auckland"], ["wellington"], ["christchurch"]] },
  "uae": { "label": "United Arab Emirates", "code": "AE", "regions": MENA,
    "names": ["united arab emirates", "uae", "emirates"], "cities": [["dubai"], ["abu dhabi"], ["sharjah"]] },
  "saudi arabia": { "label": "Saudi Arabia", "code": "SA", "regions": MENA, "names": ["saudi arabia", "ksa"],
    "cities": [["riyadh"], ["jeddah"]] },
  "qatar": { "label": "Qatar", "code": "QA", "regions": MENA, "names": ["qatar"], "cities": [["doha"]] },
  "israel": { "label": "Israel", "code": "IL", "regions": MENA, "names": ["israel"],
    "cities": [["tel aviv"], ["jerusalem"], ["haifa"]] },
  "egypt": { "label": "Egypt", "code": "EG", "regions": [*AFRICA, "mena"], "names": ["egypt"],
    "cities": [["cairo"], ["alexandria"]] },
  "morocco": { "label": "Morocco", "code": "MA", "regions": [*AFRICA, "mena"], "names": ["morocco"],
    "cities": [["casablanca"], ["rabat"]] },
  "south africa": { "label": "South Africa", "code": "ZA", "regions": AFRICA, "names": ["south africa"],
    "cities": [["cape town"], ["johannesburg"], ["durban"], ["pretoria"]] },
  "nigeria": { "label": "Nigeria", "code": "NG", "regions": AFRICA, "names": ["nigeria"], "cities": [["lagos"], ["abuja"]] },
  "kenya": { "label": "Kenya", "code": "KE", "regions": AFRICA, "names": ["kenya"], "cities": [["nairobi"]] },
}

US_STATES = frozenset(("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE " "NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC").split())

CANADIAN_PROVINCES = frozenset("ON QC BC AB MB SK NS NB NL PE NT YT NU".split())

GLOBAL_TERMS = ["worldwide", "anywhere", "global", "globally"]

REMOTE_TERMS = ["remote", "remotely", "work from home", "wfh", "homeoffice", "home office", "telework",
  "telecommute", "distributed", "teletrabajo", "teletravail", "τηλεργασια", "remoto", "zdalnie", "smart working"]


# ── Lookup tables, built once ─────────────────────────────────

TERMS: dict[str, dict] = {}       # folded term (words joined by one space) → what it names
STEMS: list[tuple[str, dict]] = []  # (prefix, what it names) for terms written with a trailing "*"
CODES: dict[str, str] = {}        # upper-case country code → country key
_longest_term = 1                 # in words


def _add_term(term: str, meaning: dict) -> None:
    global _longest_term
    if term.endswith("*"):
        STEMS.append((term[:-1], meaning))
        return
    TERMS[term] = meaning
    _longest_term = max(_longest_term, len(term.split(" ")))


for _region, _terms in REGIONS.items():
    for _term in _terms:
        _add_term(_term, {"region": _region})
for _country, _info in COUNTRIES.items():
    for _term in _info["names"]:
        _add_term(_term, {"country": _country})
    for _spellings in _info["cities"]:
        for _term in _spellings:
            _add_term(_term, {"country": _country, "city": _spellings[0]})
    CODES[_info["code"]] = _country
CODES["UK"] = "uk"
for _term in GLOBAL_TERMS:
    _add_term(_term, {"global": True})
for _term in REMOTE_TERMS:
    _add_term(_term, {"remote": True})


# ── Reading places out of text ────────────────────────────────

def fold(text: str | None) -> str:
    """Lower case without accents: "Zürich" → "zurich", "Αθήνα" → "αθηνα"."""
    decomposed = unicodedata.normalize("NFKD", text or "")
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch)).lower()


@dataclass(frozen=True)
class Places:
    countries: frozenset = frozenset()
    cities: frozenset = frozenset()
    regions: frozenset = frozenset()
    global_: bool = False   # open everywhere
    remote: bool = False

    def __or__(self, other: "Places") -> "Places":
        return Places(self.countries | other.countries, self.cities | other.cities,
                      self.regions | other.regions, self.global_ or other.global_, self.remote or other.remote)


_UPPER_CODE = re.compile(r"(?<!\w)([A-Z]{2})(?!\w)")
_LOWER_LAST_PART = re.compile(r",\s*([a-z]{2})\s*$")


@lru_cache(maxsize=20000)
def places_in(text: str, names_only: bool = False) -> Places:
    """
    The places a piece of text names. With names_only, codes and words under
    four letters are ignored, for text such as job titles where "IT" means
    information technology, not Italy.
    """
    countries, cities, regions = set(), set(), set()
    flags = {"global": False, "remote": False}

    def record(meaning: dict) -> None:
        if "country" in meaning:
            countries.add(meaning["country"])
        if "city" in meaning:
            cities.add(meaning["city"])
        if "region" in meaning:
            regions.add(meaning["region"])
        for flag in ("global", "remote"):
            if meaning.get(flag):
                flags[flag] = True

    # "U.S." would otherwise fall apart into the letters u and s.
    words = [w for w in re.split(r"[\W_]+", fold(re.sub(r"\bu\.s\.(?:a\.)?", "usa", text or "", flags=re.I))) if w]

    # Longest terms first, so "Latin America" is the region and not the USA,
    # and every word counts for one place only.
    used = [False] * len(words)
    for size in range(min(_longest_term, len(words)), 0, -1):
        for start in range(0, len(words) - size + 1):
            if any(used[start:start + size]):
                continue
            term = " ".join(words[start:start + size])
            meaning = TERMS.get(term)
            if not meaning or (names_only and len(term) < 4):
                continue
            record(meaning)
            used[start:start + size] = [True] * size
    for i, word in enumerate(words):
        if not used[i]:
            stem = next((meaning for prefix, meaning in STEMS if word.startswith(prefix)), None)
            if stem:
                record(stem)

    if not names_only:
        for country in _country_codes_in(text or "", countries):
            record({"country": country})
    # "Anywhere in France" is anywhere within France, not anywhere in the world.
    if countries or regions:
        flags["global"] = False
    return Places(frozenset(countries), frozenset(cities), frozenset(regions), flags["global"], flags["remote"])


def _country_codes_in(text: str, countries: set) -> list[str]:
    """Country keys for the two-letter codes in a text, read in the light of what else it names."""
    codes = _UPPER_CODE.findall(text)
    last = _LOWER_LAST_PART.search(text)
    if last:
        codes.append(last.group(1).upper())
    points_at_us = "us" in countries or any(c in US_STATES and c not in CODES for c in codes)
    points_at_canada = "canada" in countries or any(c in CANADIAN_PROVINCES and c not in CODES for c in codes)
    found = []
    for code in codes:
        if points_at_us and code in US_STATES:
            found.append("us")
        elif points_at_canada and code in CANADIAN_PROVINCES:
            found.append("canada")
        elif code in CODES:
            found.append(CODES[code])
    return found


def regions_of(country: str) -> list[str]:
    """The regions a country belongs to, e.g. greece → eu, europe, emea."""
    return list(COUNTRIES.get(country, {}).get("regions", []))


# Regions that contain other regions: a job open to EMEA is open to Europe.
REGION_PARENTS = {
    "eu": ["europe", "emea"], "europe": ["emea"], "mena": ["emea"], "africa": ["emea"],
    "north america": ["americas"], "latam": ["americas"], "oceania": ["apac"],
}


def regions_overlap(a: str, b: str) -> bool:
    """Whether two regions overlap: the same one, or one inside the other."""
    return a == b or b in REGION_PARENTS.get(a, []) or a in REGION_PARENTS.get(b, [])


def resolve_place(typed: str) -> dict:
    """
    What a place the user typed refers to: remote work, a city, a country, a
    region, or (for places this module doesn't know, like a small town) the text itself.
    """
    label = (typed or "").strip()
    found = places_in(label)
    if found.remote and not found.countries and not found.regions:
        return {"kind": "remote", "label": label}
    if len(found.cities) == 1:
        return {"kind": "city", "label": label, "city": next(iter(found.cities)),
                "country": next(iter(found.countries), None)}
    if len(found.countries) == 1:
        return {"kind": "country", "label": label, "country": next(iter(found.countries))}
    if len(found.regions) == 1 and not found.countries:
        return {"kind": "region", "label": label, "region": next(iter(found.regions))}
    return {"kind": "text", "label": label, "text": fold(label)}
