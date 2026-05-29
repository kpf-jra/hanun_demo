import fs from "fs";
const line = fs
  .readFileSync("apps/news-verification/news-verification.js", "utf8")
  .split(/\n/)[963];
for (let i = 0; i < line.length; i++) {
  const c = line[i];
  const cp = c.codePointAt(0);
  if (cp === 39 || cp === 8217 || cp === 8216 || cp === 96) {
    console.log(i, c, cp);
  }
}
