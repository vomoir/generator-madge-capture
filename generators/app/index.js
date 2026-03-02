import Generator from "yeoman-generator";
import chalk from "chalk";
import yosay from "yosay";
import os from "node:os";
import madge from "madge";
import path from "path";
import fs, { rmSync } from "fs";

import { saveMadgeReports } from "./lib/saveMadgeReports.js"; // Remember the .js!
import {
  openExplorer,
  syncDependencies,
  findCommonBase,
  getSourceVersions,
  getSourceAliases,
  findProjectRoot,
} from "./lib/extractComponents.js";
import { getPrompts } from "./lib/prompts.js";

export default class extends Generator {
  initializing() {}

  welcome() {
    this.log("MADGE CAPTURE  P R O J E C T");
  }
  async prompting() {
    let msgText =
      "This generator will run MADGE at a given location and save the output.\n\n";
    msgText +=
      "It will create a new folder with the name you specify, and populate it with the necessary madge files.\n";
    this.log(
      yosay(
        chalk.red.bold("Welcome to the Madge Capture Project generator!\n\n") +
          chalk.whiteBright(msgText),
      ),
    );
    const homeDir = os.homedir(); // ← "C:\Users\<USERNAME>"
    const defaultCaptureBase = path.join(homeDir, "madge-capture");

    try {
      this.answers = await this.prompt(getPrompts(defaultCaptureBase));
    } catch (e) {
      this.log("\n👋 Goodbye! Generator cancelled.");
      process.exit(0);
    }
  }

  async writing() {
    const { sourcePath, mode } = this.answers;

    // Validate existence
    if (!fs.existsSync(sourcePath)) {
      this.log.error(`File not found: ${sourcePath}`);
      return;
    }

    const componentName = path.parse(sourcePath).name;
    let finalTarget;
    let extractionDir;

    if (mode === "existing") {
      finalTarget = path.join(
        this.answers.existingProjectPath,
        this.answers.componentSubDir,
        componentName,
      );
      extractionDir = finalTarget;
    } else {
      finalTarget = path.join(this.answers.outputPath, componentName);
      extractionDir =
        mode === "new" ? path.join(finalTarget, "src") : finalTarget;
    }

    // Clean up previous extraction...
    if (fs.existsSync(finalTarget)) {
      this.log(`🧹 Cleaning up old extraction at ${finalTarget}...`);
      // Recursive delete to ensure a fresh start
      try {
        rmSync(finalTarget, { recursive: true, force: true });
      } catch (err) {
        this.log.error(`\n❌ Could not clean up ${finalTarget}`);
        this.log.error(`   ${err.message}`);
        if (err.code === "EPERM" || err.code === "EACCES") {
          this.log.error(
            "   💡 You may not have write permissions for this folder.",
          );
        }
        process.exit(1);
      }
    }

    this.log(`🚀 Analyzing ${componentName}...\n`);

    // =============================================
    // Run Madge
    // =============================================
    try {
      const res = await madge(sourcePath, {
        baseDir: path.dirname(sourcePath),
      });

      const madgeObj = res.obj();
      // 1. Get ALL absolute paths (including the entry file)
      const absoluteList = [path.resolve(sourcePath)];
      // 2. Resolve all unique absolute paths
      const uniquePaths = new Set();
      uniquePaths.add(path.resolve(sourcePath)); // Add the entry file itself

      Object.entries(madgeObj).forEach(([file, deps]) => {
        const dir = path.dirname(sourcePath);
        absoluteList.push(path.resolve(dir, file));
        deps.forEach((d) => absoluteList.push(path.resolve(dir, d)));
      });

      // 2. Find the Common Ancestor (The "New Horizon")
      const commonBase = findCommonBase(absoluteList);
      this.log(`📍 Common Base identified: ${commonBase}`);
      
      let relativeComponentPath = path
        .relative(commonBase, sourcePath)
        .replace(/\\/g, "/");

      // Check if the source was a .js file that we likely renamed to .jsx
      if (relativeComponentPath.endsWith(".js")) {
        const content = fs.readFileSync(sourcePath, "utf8");
        if (/<[A-Z]/.test(content) || /import.*React/i.test(content)) {
          relativeComponentPath = relativeComponentPath.replace(
            /\.js$/,
            ".jsx",
          );
        }
      }

      // For templates to point to the right place
      if (mode === "new") {
        relativeComponentPath = "src/" + relativeComponentPath;
      }

      this.log(`📍 Relative Component Path identified: ${relativeComponentPath}\n`);

      const assetExtensions = [
        ".css",
        ".scss",
        ".sass",
        ".svg",
        ".png",
        ".jpg",
      ];
      const expandedList = new Set(absoluteList);

      // Look for siblings of our JS dependencies
      absoluteList.forEach((filePath) => {
        const dir = path.dirname(filePath);
        const siblings = fs.readdirSync(dir);

        siblings.forEach((file) => {
          const ext = path.extname(file).toLowerCase();
          if (assetExtensions.includes(ext)) {
            expandedList.add(path.resolve(dir, file));
          }
        });
      });

      const finalCopyList = Array.from(expandedList);
      this.log(
        `🎨 Added ${finalCopyList.length - absoluteList.length} assets to the queue.`,
      );

      // --- Parse & Normalize Aliases ---
      let rawAliasMap = {};

      // 1. Auto-detect from config files if requested
      if (this.answers.autoDetectAliases) {
        rawAliasMap = getSourceAliases(this, path.dirname(sourcePath));
        const detectedCount = Object.keys(rawAliasMap).length;
        if (detectedCount > 0) {
          this.log(`🔍 Detected ${detectedCount} aliases from config file.`);
        }
      }

      // 2. Add manual aliases (manual overrides auto-detected)
      if (this.answers.aliases) {
        const projectRoot = findProjectRoot(path.dirname(sourcePath));
        this.log(`📍 Project root for manual aliases: ${projectRoot}`);
        this.answers.aliases.split(",").forEach((item) => {
          const parts = item.split("=");
          if (parts.length === 2) {
            const alias = parts[0].trim();
            const target = parts[1].trim();
            if (alias && target) {
              // Strip leading slash if it exists so path.resolve joins it correctly
              const cleanTarget = target.replace(/^[\\\/]/, "");
              const resolvedTarget = path.resolve(projectRoot, cleanTarget);
              this.log(`   Manual alias: ${alias} -> ${resolvedTarget}`);
              rawAliasMap[alias] = resolvedTarget;
            }
          }
        });
      }

      // 3. Normalize all alias targets relative to commonBase
      const aliasMap = {};
      for (const [alias, absoluteTarget] of Object.entries(rawAliasMap)) {
        let relTarget = path
          .relative(commonBase, absoluteTarget)
          .replace(/\\/g, "/");

        // DEBUG: uncomment to see why aliases are skipped
        // this.log(`DEBUG: alias ${alias} target ${absoluteTarget} -> relative ${relTarget}`);

        // If the target is outside commonBase, we can't rewrite to it 
        // because those files aren't in our sandbox.
        if (relTarget.startsWith("..")) {
          this.log(chalk.yellow(`⚠️ Skipping alias '${alias}': target '${relTarget}' is outside common base.`));
          continue;
        }

        // if the alias points at the common base itself, use an empty
        // string so that every path under the base can be rewritten
        if (!relTarget || relTarget === ".") {
          relTarget = "";
        }
        aliasMap[alias] = relTarget;
      }

      const activeAliasCount = Object.keys(aliasMap).length;
      if (activeAliasCount > 0) {
        this.log(`✨ ${activeAliasCount} aliases active for import rewriting.`);
        Object.entries(aliasMap).forEach(([alias, target]) => {
            this.log(`   ${alias} -> ${target || "./"}`);
        });
      }

      // 4. Sync using the commonBase as the anchor
      syncDependencies(
        this,
        finalCopyList,
        commonBase,
        extractionDir,
        aliasMap,
      );

      await saveMadgeReports(res, finalTarget, componentName);

      this.log(`✅ Reports saved to: ${finalTarget}`);
      // =============================================
      // Populate sandbox components
      // =============================================
      const shouldGenerateTemplates =
        (mode === "new" && this.answers.createSandBox) || mode === "existing";

      if (shouldGenerateTemplates) {
        this.log(`✅ Copying templates: ${componentName}`);
        const peerDepsToSync = [
          "react",
          "react-dom",
          "react-datepicker",
          "react-select",
          "react-router",
          "prop-types",
          "date-fns",
          "lucide-react",
          "@mui/material",
          "framer-motion",
          "styled-components",
          "lodash",
          "react-hot-toast",
        ];
        // Grab the actual versions from your D: drive
        const syncedVersions = getSourceVersions(
          path.dirname(sourcePath),
          peerDepsToSync,
        );

        // Merge with your defaults (fallback to 18.2.0 if not found)
        const finalDeps = {
          react: syncedVersions["react"] || "^18.2.0",
          "react-dom": syncedVersions["react-dom"] || "^18.2.0",
          ...syncedVersions,
        };

        this.log(
          `📦 Synced ${Object.keys(syncedVersions).length} peer dependencies from source.`,
        );

        if (mode === "new") {
          // Pass finalDeps to the Template
          this.fs.copyTpl(
            this.templatePath("sandbox/package.json"),
            path.join(finalTarget, "package.json"),
            {
              componentName,
              dependenciesJSON: JSON.stringify(finalDeps, null, 2).replace(
                /\n/g,
                "\n    ",
              ),
            },
          );

          // For the template, we want the alias targets to point to src/relTarget
          const templateAliasMap = {};
          for (const [alias, relTarget] of Object.entries(aliasMap)) {
            templateAliasMap[alias] = "src/" + relTarget.replace(/^\.\//, "").replace(/\/$/, "");
            if (templateAliasMap[alias].endsWith("src")) {
                templateAliasMap[alias] = "src";
            }
          }

          this.fs.copyTpl(
            this.templatePath("sandbox/vite.config.js"),
            path.join(finalTarget, "vite.config.js"),
            { aliasMap: templateAliasMap },
          );

          this.fs.copyTpl(
            this.templatePath("sandbox/index.html"),
            path.join(finalTarget, "index.html"),
            { componentName, relativeComponentPath },
          );

          // Define the storybook config directory
          const sbConfigDir = path.join(finalTarget, ".storybook");

          // Copy main.js
          this.fs.copyTpl(
            this.templatePath("sandbox/.storybook/main.js"),
            path.join(sbConfigDir, "main.js"),
          );

          // Copy preview.js
          this.fs.copyTpl(
            this.templatePath("sandbox/.storybook/preview.js"),
            path.join(sbConfigDir, "preview.js"),
          );

          // Readme.md file
          this.fs.copyTpl(
            this.templatePath("sandbox/README.md"),
            path.join(finalTarget, "README.md"),
            {
              componentName,
              sourcePath: this.answers.sourcePath, // The D: drive path
              commonBase, // The anchor point
              relativeComponentPath,
            },
          );
        }

        this.fs.copyTpl(
          this.templatePath("sandbox/Component.stories.jsx"),
          path.join(finalTarget, `${componentName}.stories.jsx`),
          {
            componentName,
            relativeComponentPath, // Point to the extracted location
          },
        );

        await this.fs.commit(); // Forces Yeoman to write templates to disk NOW
      }
    } catch (err) {
      if (err.code === "EPERM" || err.code === "EACCES") {
        this.log.error(`\n❌ Permission denied while writing files!`);
        this.log.error(`   Destination: ${finalTarget}`);
        this.log.error(
          "   💡 Please check you have write access to this location.",
        );
        process.exit(1);
      }
      this.log.error(`Failed to process reports: ${err.message}`);
      console.error(err);
    }
  }
  async install() {
    if (this.answers.mode === "new" && this.answers.createSandBox) {
      console.log("Installing dependencies, please wait...");
      const componentName = path.parse(this.answers.sourcePath).name;
      const finalTarget = path.join(this.answers.outputPath, componentName);

      this.log(`\n📦 Running npm install in ${finalTarget}...`);

      // We use spawnSync to ensure it finishes before the 'end' phase
      this.spawnSync("npm", ["install"], {
        cwd: finalTarget,
      });
    }
  }
  async end() {
    const componentName = path.parse(this.answers.sourcePath).name;
    let finalPath;
    if (this.answers.mode === "existing") {
      finalPath = path.join(
        this.answers.existingProjectPath,
        this.answers.componentSubDir,
        componentName,
      );
    } else {
      finalPath = path.join(this.answers.outputPath, componentName);
    }

    this.log("\n" + "=".repeat(40));
    this.log("🚀 EXTRACTION COMPLETE!");
    this.log("=".repeat(40));
    this.log(`📍 Location: ${finalPath}`);
    this.log("=".repeat(40));

    if (this.answers.mode === "new" && this.answers.createSandBox) {
      this.log(`\nTo start your component, run:`);
      this.log(`1. cd "${finalPath}"`);
      this.log(`2. npm run storybook   <-- View component in isolation`);
      this.log(`3. npm run dev         <-- View raw Vite app`);
    } else if (this.answers.mode === "existing") {
      this.log(`\nComponent added to existing project.`);
      this.log(`You may need to install missing dependencies manually.`);
    } else if (this.answers.mode === "dependency_only") {
      this.log(`To view your component:`);
      this.log(`→   cd "${finalPath}"`);
      this.log(`You may need to install missing dependencies manually.`);
    }

    // open the folder for the user if requested
    if (this.answers.openExplorer) openExplorer(finalPath);
  }
}
