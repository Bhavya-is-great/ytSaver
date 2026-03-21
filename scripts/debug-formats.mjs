import { Innertube } from "youtubei.js";

const youtube = await Innertube.create({
  lang: "en",
  location: "US",
  retrieve_player: true,
  generate_session_locally: true,
});

const info = await youtube.getInfo("4adZ7AguVcw", "TV_EMBEDDED");

const allFormats = [
  ...(info.streaming_data?.formats || []),
  ...(info.streaming_data?.adaptive_formats || []),
];

console.log("Total formats:", allFormats.length);
console.log("Player available:", !!youtube.session.player);

const sample = allFormats[0];
console.log("\n=== FORMAT KEYS ===");
console.log(Object.keys(sample));

console.log("\n=== FULL FORMAT[0] ===");
console.log(JSON.stringify(sample, null, 2));

console.log("\n=== FORMAT[0] url property ===");
console.log("url:", sample.url);
console.log("url type:", typeof sample.url);

console.log("\n=== FORMAT[0] cipher properties ===");
console.log("signature_cipher:", sample.signature_cipher);
console.log("signatureCipher:", sample.signatureCipher);

console.log("\n=== FORMAT[0] methods ===");
console.log("has decipher:", typeof sample.decipher);
console.log("has decipher_url:", typeof sample.decipher_url);
console.log("has getUrl:", typeof sample.getUrl);

// Try every possible method to get a URL
console.log("\n=== TRYING ALL URL METHODS ===");

if (sample.url) {
  console.log("Direct url:", sample.url.substring(0, 100));
}

if (typeof sample.decipher === "function") {
  try {
    const result = await sample.decipher(youtube.session.player);
    console.log("decipher(player):", result?.substring(0, 100));
  } catch (e) {
    console.log("decipher(player) error:", e.message);
  }

  try {
    const result = await sample.decipher(youtube.session);
    console.log("decipher(session):", result?.substring(0, 100));
  } catch (e) {
    console.log("decipher(session) error:", e.message);
  }
}

if (typeof sample.getUrl === "function") {
  try {
    const result = await sample.getUrl(youtube.session.player);
    console.log("getUrl(player):", result?.substring(0, 100));
  } catch (e) {
    console.log("getUrl(player) error:", e.message);
  }
}