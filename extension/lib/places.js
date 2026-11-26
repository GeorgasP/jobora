/*
 * Places: countries, their main job markets, the regions they belong to, and
 * the words job ads use for all of them.
 *
 * The matcher asks two questions of every job:
 *   1. Does its location name a place the user wants? ("Berlin, Germany" is in
 *      the EU; "Evergreen Account Manager" is not in Greece just because it
 *      contains the letters "gr".)
 *   2. If it is remote, is it open to where the user is? ("Remote - Canada" is
 *      not open to someone in Greece; "Remote (Europe)" is.)
 *
 * Words are matched whole, after folding (lower case, no accents), so "Zürich"
 * matches "Zurich" and "Αθήνα" matches "αθηνα". A term ending in "*" matches
 * any word that starts with it, for inflected languages: "αθην*" covers Αθήνα,
 * Αθήνας and Αθηνών. Two-letter country codes count only in capitals ("DE",
 * "US") or as the last part of a location ("Madrid, es"), because in lower case
 * they are ordinary words ("Rio de Janeiro").
 */

export const fold = (s) => String(s || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();

// Regions a country can belong to, with the words ads use for each.
const REGIONS = {
  eu: ["eu", "european union", "eea", "schengen"],
  europe: ["europe", "european", "cet", "cest", "eet"],
  emea: ["emea"],
  "north america": ["north america"],
  americas: ["americas"],
  latam: ["latam", "latin america", "south america", "central america"],
  apac: ["apac", "asia", "asia pacific"],
  mena: ["mena", "middle east", "gcc"],
  africa: ["africa"],
  oceania: ["oceania", "anz"],
};

const EU = ["eu", "europe", "emea"];
const EUROPE = ["europe", "emea"];
const NORTH_AMERICA = ["north america", "americas"];
const LATAM = ["americas", "latam"];
const APAC = ["apac"];
const MENA = ["mena", "emea"];
const AFRICA = ["africa", "emea"];

// Each country: its English label, ISO code, regions, the names ads use for it,
// and its main cities. Each inner list of `cities` is one city with its
// spellings; the first spelling is the city's key.
const COUNTRIES = {
  greece: { label: "Greece", code: "GR", regions: EU,
    names: ["greece", "hellas", "ellada", "ελλαδα", "ελλας"],
    cities: [["athens", "athina", "αθην*", "attica", "attiki", "αττικ*"], ["thessaloniki", "θεσσαλονικ*"],
      ["piraeus", "πειραι*"], ["patras", "πατρα*"], ["heraklion", "iraklio", "ηρακλει*"],
      ["larissa", "λαρισ*"], ["ioannina", "ιωαννιν*"], ["chania", "χανι*"]] },
  cyprus: { label: "Cyprus", code: "CY", regions: EU, names: ["cyprus", "κυπρο*"],
    cities: [["nicosia", "λευκωσι*"], ["limassol", "λεμεσ*"], ["larnaca", "λαρνακ*"], ["paphos", "παφο*"]] },
  germany: { label: "Germany", code: "DE", regions: EU,
    names: ["germany", "deutschland", "allemagne", "alemania", "germania", "niemcy"],
    cities: [["berlin"], ["munich", "munchen"], ["hamburg"], ["frankfurt"], ["cologne", "koln"],
      ["stuttgart"], ["dusseldorf"], ["leipzig"], ["dresden"], ["hannover", "hanover"],
      ["nuremberg", "nurnberg"], ["bremen"], ["essen"], ["dortmund"], ["karlsruhe"], ["mannheim"]] },
  austria: { label: "Austria", code: "AT", regions: EU, names: ["austria", "osterreich"],
    cities: [["vienna", "wien"], ["graz"], ["linz"], ["salzburg"], ["innsbruck"]] },
  switzerland: { label: "Switzerland", code: "CH", regions: EUROPE,
    names: ["switzerland", "schweiz", "suisse", "svizzera"],
    cities: [["zurich"], ["geneva", "geneve", "genf"], ["basel"], ["bern"], ["lausanne"], ["lugano"], ["zug"]] },
  france: { label: "France", code: "FR", regions: EU, names: ["france", "frankreich", "francia"],
    cities: [["paris"], ["lyon"], ["marseille"], ["toulouse"], ["lille"], ["bordeaux"], ["nantes"], ["nice"]] },
  belgium: { label: "Belgium", code: "BE", regions: EU, names: ["belgium", "belgique", "belgie"],
    cities: [["brussels", "bruxelles", "brussel"], ["antwerp", "antwerpen"], ["ghent", "gent"]] },
  netherlands: { label: "Netherlands", code: "NL", regions: EU, names: ["netherlands", "nederland", "holland"],
    cities: [["amsterdam"], ["rotterdam"], ["utrecht"], ["eindhoven"], ["the hague", "den haag"]] },
  luxembourg: { label: "Luxembourg", code: "LU", regions: EU, names: ["luxembourg", "luxemburg"], cities: [] },
  ireland: { label: "Ireland", code: "IE", regions: EU, names: ["ireland", "eire"],
    cities: [["dublin"], ["cork"], ["galway"]] },
  uk: { label: "United Kingdom", code: "GB", regions: EUROPE,
    names: ["united kingdom", "uk", "great britain", "britain", "england", "scotland", "wales", "northern ireland"],
    cities: [["london"], ["manchester"], ["birmingham"], ["edinburgh"], ["glasgow"], ["bristol"], ["leeds"],
      ["cambridge"], ["oxford"], ["belfast"]] },
  spain: { label: "Spain", code: "ES", regions: EU, names: ["spain", "espana", "espanya"],
    cities: [["madrid"], ["barcelona"], ["valencia"], ["seville", "sevilla"], ["malaga"], ["bilbao"]] },
  portugal: { label: "Portugal", code: "PT", regions: EU, names: ["portugal"],
    cities: [["lisbon", "lisboa"], ["porto"]] },
  italy: { label: "Italy", code: "IT", regions: EU, names: ["italy", "italia"],
    cities: [["rome", "roma"], ["milan", "milano"], ["turin", "torino"], ["naples", "napoli"], ["bologna"],
      ["florence", "firenze"]] },
  malta: { label: "Malta", code: "MT", regions: EU, names: ["malta"], cities: [["valletta"]] },
  poland: { label: "Poland", code: "PL", regions: EU, names: ["poland", "polska"],
    cities: [["warsaw", "warszawa"], ["krakow"], ["wroclaw"], ["gdansk"], ["poznan"]] },
  czechia: { label: "Czechia", code: "CZ", regions: EU, names: ["czechia", "czech republic", "cesko"],
    cities: [["prague", "praha"], ["brno"]] },
  slovakia: { label: "Slovakia", code: "SK", regions: EU, names: ["slovakia", "slovensko"], cities: [["bratislava"]] },
  hungary: { label: "Hungary", code: "HU", regions: EU, names: ["hungary", "magyarorszag"], cities: [["budapest"]] },
  romania: { label: "Romania", code: "RO", regions: EU, names: ["romania"],
    cities: [["bucharest", "bucuresti"], ["cluj"], ["iasi"], ["timisoara"]] },
  bulgaria: { label: "Bulgaria", code: "BG", regions: EU, names: ["bulgaria"],
    cities: [["sofia"], ["plovdiv"], ["varna"]] },
  croatia: { label: "Croatia", code: "HR", regions: EU, names: ["croatia", "hrvatska"], cities: [["zagreb"]] },
  slovenia: { label: "Slovenia", code: "SI", regions: EU, names: ["slovenia", "slovenija"], cities: [["ljubljana"]] },
  estonia: { label: "Estonia", code: "EE", regions: EU, names: ["estonia"], cities: [["tallinn"]] },
  latvia: { label: "Latvia", code: "LV", regions: EU, names: ["latvia"], cities: [["riga"]] },
  lithuania: { label: "Lithuania", code: "LT", regions: EU, names: ["lithuania"], cities: [["vilnius"]] },
  denmark: { label: "Denmark", code: "DK", regions: EU, names: ["denmark", "danmark"],
    cities: [["copenhagen", "kobenhavn"], ["aarhus"]] },
  sweden: { label: "Sweden", code: "SE", regions: EU, names: ["sweden", "sverige"],
    cities: [["stockholm"], ["gothenburg", "goteborg"], ["malmo"]] },
  finland: { label: "Finland", code: "FI", regions: EU, names: ["finland", "suomi"],
    cities: [["helsinki"], ["espoo"], ["tampere"]] },
  // Not in the EU, but in the EEA: the same right to work as EU citizens.
  norway: { label: "Norway", code: "NO", regions: EU, names: ["norway", "norge"], cities: [["oslo"], ["bergen"]] },
  iceland: { label: "Iceland", code: "IS", regions: EU, names: ["iceland"], cities: [["reykjavik"]] },
  serbia: { label: "Serbia", code: "RS", regions: EUROPE, names: ["serbia", "srbija"],
    cities: [["belgrade", "beograd"], ["novi sad"]] },
  ukraine: { label: "Ukraine", code: "UA", regions: EUROPE, names: ["ukraine", "ukraina"],
    cities: [["kyiv", "kiev"], ["lviv"], ["kharkiv"]] },
  turkey: { label: "Turkey", code: "TR", regions: EUROPE, names: ["turkey", "turkiye"],
    cities: [["istanbul"], ["ankara"], ["izmir"]] },
  albania: { label: "Albania", code: "AL", regions: EUROPE, names: ["albania"], cities: [["tirana"]] },
  "north macedonia": { label: "North Macedonia", code: "MK", regions: EUROPE, names: ["north macedonia"],
    cities: [["skopje"]] },
  us: { label: "United States", code: "US", regions: NORTH_AMERICA,
    names: ["united states", "usa", "america", "california", "texas", "florida", "washington", "massachusetts",
      "illinois", "colorado", "virginia", "north carolina", "ohio", "michigan", "oregon", "arizona",
      "pennsylvania", "new jersey", "utah", "minnesota", "tennessee"],
    cities: [["new york", "nyc", "brooklyn"], ["san francisco", "bay area"], ["los angeles"], ["seattle"],
      ["austin"], ["boston"], ["chicago"], ["denver"], ["atlanta"], ["miami"], ["dallas"], ["houston"],
      ["philadelphia"], ["phoenix"], ["san diego"], ["san jose"], ["portland"], ["salt lake city"],
      ["nashville"], ["pittsburgh"], ["detroit"], ["minneapolis"], ["raleigh"], ["menlo park"],
      ["palo alto"], ["mountain view"], ["sunnyvale"], ["bellevue"], ["redmond"], ["santa clara"],
      ["cupertino"]] },
  canada: { label: "Canada", code: "CA", regions: NORTH_AMERICA,
    names: ["canada", "ontario", "quebec", "british columbia", "alberta", "nova scotia", "manitoba"],
    cities: [["toronto"], ["vancouver"], ["montreal"], ["ottawa"], ["calgary"], ["edmonton"], ["waterloo"],
      ["winnipeg"]] },
  mexico: { label: "Mexico", code: "MX", regions: [...NORTH_AMERICA, "latam"], names: ["mexico"],
    cities: [["mexico city", "cdmx"], ["guadalajara"], ["monterrey"]] },
  brazil: { label: "Brazil", code: "BR", regions: LATAM, names: ["brazil", "brasil"],
    cities: [["sao paulo"], ["rio de janeiro"], ["belo horizonte"], ["curitiba"], ["porto alegre"],
      ["florianopolis"]] },
  argentina: { label: "Argentina", code: "AR", regions: LATAM, names: ["argentina"], cities: [["buenos aires"]] },
  chile: { label: "Chile", code: "CL", regions: LATAM, names: ["chile"], cities: [["santiago"]] },
  colombia: { label: "Colombia", code: "CO", regions: LATAM, names: ["colombia"],
    cities: [["bogota"], ["medellin"]] },
  peru: { label: "Peru", code: "PE", regions: LATAM, names: ["peru"], cities: [["lima"]] },
  uruguay: { label: "Uruguay", code: "UY", regions: LATAM, names: ["uruguay"], cities: [["montevideo"]] },
  "costa rica": { label: "Costa Rica", code: "CR", regions: LATAM, names: ["costa rica"], cities: [] },
  india: { label: "India", code: "IN", regions: APAC, names: ["india"],
    cities: [["bangalore", "bengaluru"], ["mumbai"], ["delhi", "new delhi"], ["hyderabad"], ["pune"],
      ["chennai"], ["gurgaon", "gurugram"], ["noida"], ["kolkata"]] },
  pakistan: { label: "Pakistan", code: "PK", regions: APAC, names: ["pakistan"],
    cities: [["karachi"], ["lahore"], ["islamabad"]] },
  singapore: { label: "Singapore", code: "SG", regions: APAC, names: ["singapore"], cities: [] },
  malaysia: { label: "Malaysia", code: "MY", regions: APAC, names: ["malaysia"], cities: [["kuala lumpur"]] },
  philippines: { label: "Philippines", code: "PH", regions: APAC, names: ["philippines"],
    cities: [["manila"], ["makati"], ["cebu"]] },
  indonesia: { label: "Indonesia", code: "ID", regions: APAC, names: ["indonesia"], cities: [["jakarta"], ["bali"]] },
  thailand: { label: "Thailand", code: "TH", regions: APAC, names: ["thailand"], cities: [["bangkok"]] },
  vietnam: { label: "Vietnam", code: "VN", regions: APAC, names: ["vietnam", "viet nam"],
    cities: [["ho chi minh", "saigon"], ["hanoi"]] },
  japan: { label: "Japan", code: "JP", regions: APAC, names: ["japan"], cities: [["tokyo"], ["osaka"], ["kyoto"]] },
  "south korea": { label: "South Korea", code: "KR", regions: APAC, names: ["south korea", "korea"],
    cities: [["seoul"], ["busan"]] },
  china: { label: "China", code: "CN", regions: APAC, names: ["china"],
    cities: [["beijing"], ["shanghai"], ["shenzhen"], ["guangzhou"], ["hangzhou"]] },
  "hong kong": { label: "Hong Kong", code: "HK", regions: APAC, names: ["hong kong"], cities: [] },
  taiwan: { label: "Taiwan", code: "TW", regions: APAC, names: ["taiwan"], cities: [["taipei"]] },
  australia: { label: "Australia", code: "AU", regions: [...APAC, "oceania"], names: ["australia"],
    cities: [["sydney"], ["melbourne"], ["brisbane"], ["perth"], ["adelaide"], ["canberra"]] },
  "new zealand": { label: "New Zealand", code: "NZ", regions: [...APAC, "oceania"], names: ["new zealand"],
    cities: [["auckland"], ["wellington"], ["christchurch"]] },
  uae: { label: "United Arab Emirates", code: "AE", regions: MENA,
    names: ["united arab emirates", "uae", "emirates"], cities: [["dubai"], ["abu dhabi"], ["sharjah"]] },
  "saudi arabia": { label: "Saudi Arabia", code: "SA", regions: MENA, names: ["saudi arabia", "ksa"],
    cities: [["riyadh"], ["jeddah"]] },
  qatar: { label: "Qatar", code: "QA", regions: MENA, names: ["qatar"], cities: [["doha"]] },
  israel: { label: "Israel", code: "IL", regions: MENA, names: ["israel"],
    cities: [["tel aviv"], ["jerusalem"], ["haifa"]] },
  egypt: { label: "Egypt", code: "EG", regions: [...AFRICA, "mena"], names: ["egypt"],
    cities: [["cairo"], ["alexandria"]] },
  morocco: { label: "Morocco", code: "MA", regions: [...AFRICA, "mena"], names: ["morocco"],
    cities: [["casablanca"], ["rabat"]] },
  "south africa": { label: "South Africa", code: "ZA", regions: AFRICA, names: ["south africa"],
    cities: [["cape town"], ["johannesburg"], ["durban"], ["pretoria"]] },
  nigeria: { label: "Nigeria", code: "NG", regions: AFRICA, names: ["nigeria"], cities: [["lagos"], ["abuja"]] },
  kenya: { label: "Kenya", code: "KE", regions: AFRICA, names: ["kenya"], cities: [["nairobi"]] },
};

// Two-letter codes that are also US states or Canadian provinces. Read as a
// state ("Remote - FL; Remote - GA") when the same text points at that
// country, otherwise as the country code ("Berlin, DE").
const US_STATES = new Set(("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE " +
  "NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC").split(" "));
const CANADIAN_PROVINCES = new Set("ON QC BC AB MB SK NS NB NL PE NT YT NU".split(" "));

// Words that say a job is open everywhere, or that it is remote.
const GLOBAL_TERMS = ["worldwide", "anywhere", "global", "globally"];
const REMOTE_TERMS = ["remote", "remotely", "work from home", "wfh", "homeoffice", "home office", "telework",
  "telecommute", "distributed", "teletrabajo", "teletravail", "τηλεργασια", "remoto", "zdalnie", "smart working"];

/* ── Lookup tables, built once ─────────────────────────────── */

const TERMS = new Map();  // folded term (words joined by one space) → what it names
const STEMS = [];         // [prefix, what it names] for terms written with a trailing "*"
const CODES = new Map();  // upper-case country code → country key
let longestTerm = 1;      // in words

function addTerm(term, meaning) {
  if (term.endsWith("*")) {
    STEMS.push([term.slice(0, -1), meaning]);
    return;
  }
  TERMS.set(term, meaning);
  longestTerm = Math.max(longestTerm, term.split(" ").length);
}

for (const [region, terms] of Object.entries(REGIONS)) terms.forEach((t) => addTerm(t, { region }));
for (const [country, info] of Object.entries(COUNTRIES)) {
  info.names.forEach((t) => addTerm(t, { country }));
  for (const spellings of info.cities) spellings.forEach((t) => addTerm(t, { country, city: spellings[0] }));
  CODES.set(info.code, country);
}
CODES.set("UK", "uk");
GLOBAL_TERMS.forEach((t) => addTerm(t, { global: true }));
REMOTE_TERMS.forEach((t) => addTerm(t, { remote: true }));

/* ── Reading places out of text ────────────────────────────── */

const cache = new Map();

/**
 * The places a piece of text names: { countries, cities, regions } as Sets of
 * keys, plus `global` (open everywhere) and `remote`. With `namesOnly`, codes
 * and words under four letters are ignored, for text such as job titles where
 * "IT" means information technology, not Italy.
 */
export function placesIn(text, { namesOnly = false } = {}) {
  const cacheKey = `${namesOnly ? 1 : 0}|${text}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const found = { countries: new Set(), cities: new Set(), regions: new Set(), global: false, remote: false };
  const record = (meaning) => {
    if (meaning.country) found.countries.add(meaning.country);
    if (meaning.city) found.cities.add(meaning.city);
    if (meaning.region) found.regions.add(meaning.region);
    if (meaning.global) found.global = true;
    if (meaning.remote) found.remote = true;
  };

  // "U.S." would otherwise fall apart into the letters u and s.
  const words = fold(String(text || "").replace(/\bu\.s\.(?:a\.)?/gi, "usa"))
    .split(/[^\p{L}\p{N}]+/u).filter(Boolean);

  // Longest terms first, so "Latin America" is the region and not the USA,
  // and every word counts for one place only.
  const used = new Array(words.length).fill(false);
  for (let size = Math.min(longestTerm, words.length); size >= 1; size--) {
    for (let start = 0; start + size <= words.length; start++) {
      if (used.slice(start, start + size).some(Boolean)) continue;
      const term = words.slice(start, start + size).join(" ");
      const meaning = TERMS.get(term);
      if (!meaning || (namesOnly && term.length < 4)) continue;
      record(meaning);
      used.fill(true, start, start + size);
    }
  }
  words.forEach((word, i) => {
    if (used[i]) return;
    const stem = STEMS.find(([prefix]) => word.startsWith(prefix));
    if (stem) record(stem[1]);
  });

  if (!namesOnly) for (const code of countryCodesIn(String(text || ""), found)) record({ country: code });
  // "Anywhere in France" is anywhere within France, not anywhere in the world.
  if (found.countries.size || found.regions.size) found.global = false;

  cache.set(cacheKey, found);
  return found;
}

/** Country keys for the two-letter codes in a text, read in the light of what else it names. */
function countryCodesIn(text, found) {
  const codes = [...text.matchAll(/(?<![\p{L}\p{N}])(\p{Lu}{2})(?![\p{L}\p{N}])/gu)].map((m) => m[1]);
  const lastPart = /,\s*(\p{Ll}{2})\s*$/u.exec(text);
  if (lastPart) codes.push(lastPart[1].toUpperCase());

  const pointsAtUS = found.countries.has("us") || codes.some((c) => US_STATES.has(c) && !CODES.has(c));
  const pointsAtCanada = found.countries.has("canada") ||
    codes.some((c) => CANADIAN_PROVINCES.has(c) && !CODES.has(c));

  const countries = [];
  for (const code of codes) {
    if (pointsAtUS && US_STATES.has(code)) countries.push("us");
    else if (pointsAtCanada && CANADIAN_PROVINCES.has(code)) countries.push("canada");
    else if (CODES.has(code)) countries.push(CODES.get(code));
  }
  return countries;
}

/** The regions a country belongs to, e.g. greece → eu, europe, emea. */
export const regionsOf = (country) => COUNTRIES[country]?.regions || [];

// Regions that contain other regions: a job open to EMEA is open to Europe.
const REGION_PARENTS = {
  eu: ["europe", "emea"], europe: ["emea"], mena: ["emea"], africa: ["emea"],
  "north america": ["americas"], latam: ["americas"], oceania: ["apac"],
};

/** Whether two regions overlap: the same one, or one inside the other. */
export const regionsOverlap = (a, b) =>
  a === b || (REGION_PARENTS[a] || []).includes(b) || (REGION_PARENTS[b] || []).includes(a);

/** The English name of a country key, e.g. "greece" → "Greece". */
export const countryLabel = (country) => COUNTRIES[country]?.label || "";

/** The ISO code of a country key, e.g. "greece" → "GR". */
export const countryCode = (country) => COUNTRIES[country]?.code || "";

/** The country key for an ISO code, e.g. "GR" or "gr" → "greece", or null. */
export const countryFromCode = (code) => CODES.get(String(code || "").toUpperCase()) || null;

/**
 * What a place the user typed refers to: remote work, a city, a country, a
 * region, or (for places this file doesn't know, like a small town) the text itself.
 */
export function resolvePlace(typed) {
  const label = String(typed || "").trim();
  const found = placesIn(label);
  if (found.remote && !found.countries.size && !found.regions.size) return { kind: "remote", label };
  if (found.cities.size === 1) {
    return { kind: "city", label, city: [...found.cities][0], country: [...found.countries][0] };
  }
  if (found.countries.size === 1) return { kind: "country", label, country: [...found.countries][0] };
  if (found.regions.size === 1 && !found.countries.size) return { kind: "region", label, region: [...found.regions][0] };
  return { kind: "text", label, text: fold(label) };
}
