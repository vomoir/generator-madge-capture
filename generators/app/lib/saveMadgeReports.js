import fs from "fs";
import path from "path";

/**
 * Generates and saves both JSON and Markdown dependency reports.
 * @param {Object} res - The result object from madge()
 * @param {string} outputDir - Directory to save files
 * @param {string} baseName - Filename without extension
 */
export const saveMadgeReports = async (res, outputDir, baseName) => {
  // 1. Generate Markdown Content
  const deps = res.obj();
  const circular = res.circular();
  const date = new Date().toLocaleDateString();

  let markdown = `# Dependency Report: ${baseName}\n`;
  markdown += `*Generated on ${date}*\n\n`;
  markdown += `## Summary\n* **Total Files:** ${Object.keys(deps).length}\n`;
  markdown += `* **Circular Dependencies:** ${circular.length > 0 ? `⚠️ ${circular.length}` : "✅ None"}\n\n`;

  markdown += `## Dependency Details\n| File | Depends On |\n| :--- | :--- |\n`;
  Object.entries(deps).forEach(([file, childDeps]) => {
    const depList =
      childDeps.length > 0
        ? childDeps.map((d) => `\`${d}\``).join(", ")
        : "_None_";
    markdown += `| \`${file}\` | ${depList} |\n`;
  });

  // 2. Prepare Paths
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const jsonPath = path.join(outputDir, `${baseName}.json`);
  const mdPath = path.join(outputDir, `${baseName}.md`);

  // 3. Write Files
  fs.writeFileSync(jsonPath, JSON.stringify(deps, null, 2));
  fs.writeFileSync(mdPath, markdown);

  return { jsonPath, mdPath };
};
