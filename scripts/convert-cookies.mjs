import fs from "fs";
import path from "path";

const inputPath = path.join(process.cwd(), "cookies.json");
const outputPath = path.join(process.cwd(), "cookies.txt");

const json = JSON.parse(fs.readFileSync(inputPath, "utf-8"));

const lines = [
  "# Netscape HTTP Cookie File",
  "# Generated for yt-dlp",
  "",
  ...json.map((c) => {
    const domain = c.domain.startsWith(".") ? c.domain : `.${c.domain}`;
    const includeSubdomains = "TRUE";
    const secure = c.secure ? "TRUE" : "FALSE";
    const expiry = c.expirationDate ? Math.floor(c.expirationDate) : 0;
    return `${domain}\t${includeSubdomains}\t${c.path}\t${secure}\t${expiry}\t${c.name}\t${c.value}`;
  }),
];

fs.writeFileSync(outputPath, lines.join("\n"), "utf-8");
console.log(`✅ Converted ${json.length} cookies → cookies.txt`);