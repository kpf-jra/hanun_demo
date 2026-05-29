const fs = require("fs");
const path = require("path");

const md = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "apps",
    "news-verification-shared",
    "news_verification_checklist.md"
  ),
  "utf8"
);
const items = [];
let section = "";
let category = "";

function pushItem(text, catOverride) {
  const t = text.trim();
  if (!t || t === "확인할 내용" || t === "체크") return;
  items.push({
    id: "i" + items.length,
    section,
    category: catOverride || category,
    text: t,
  });
}

for (const line of md.split(/\r?\n/)) {
  const h2 = line.match(/^## (\d+)\. (.+)$/);
  if (h2) {
    section = h2[2];
    category = "";
    continue;
  }
  if (!line.startsWith("|") || line.includes(":---")) continue;

  const cols = line
    .slice(1, -1)
    .split("|")
    .map((c) => c.trim());
  if (cols.length < 3) continue;

  const col0 = cols[0].replace(/\*\*/g, "");
  const col1 = cols[1];
  if (col1 === "확인할 내용" || col1 === "체크") continue;

  if (col0 && col0 !== "항목") {
    if (cols[0].includes("**")) {
      category = col0;
      pushItem(col1, category);
    } else if (col0.startsWith("(")) {
      pushItem(col0 + " — " + col1);
    } else {
      pushItem(col1);
    }
  } else {
    pushItem(col1);
  }
}

const out = path.join(
  __dirname,
  "..",
  "apps",
  "news-verification-shared",
  "news-verification-items.json"
);
fs.writeFileSync(out, JSON.stringify(items));
console.log("Wrote", items.length, "items to", out);
