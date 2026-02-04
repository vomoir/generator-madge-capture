import Generator from "yeoman-generator";
import chalk from "chalk";
import yosay from "yosay";
import commandExists from "command-exists";
import os from "node:os";
import madge from "madge";
import path from "path";
import fs from "fs";

import { saveMadgeReports } from "./lib/saveMadgeReports.js"; // Remember the .js!
import {
  openExplorer,
  syncDependencies,
  findCommonBase,
} from "./lib/extractComponents.js";
import { component } from "0g";

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
    // Don't really need this as madge is added to
    // dependencies in package.json.
    if (commandExists("madge")) {
      this.log("Madge already installed!");
    } else {
      this.log("Madge not found. Adding to dependencies...");
    }
    const homeDir = os.homedir(); // ← "C:\Users\<USERNAME>"
    const captureFolder = "madge-capture"; // ← "C:\Users\<USERNAME>\madge-capture"
    this.destinationRoot(path.join(homeDir, captureFolder));
    this.answers = await this.prompt([
      {
        type: "input",
        name: "sourcePath",
        message: "Enter the location of the component:",
        default: "D:\\Web.Application\\React\\Components\\Form.js",
        store: true,
      },
      {
        type: "input",
        name: "outputPath",
        message: "Where do you want to save the output files?",
        default: this.destinationPath(),
        store: true,
      },
      {
        type: "confirm",
        name: "createSandBox",
        message: "Create sandbox files to run in StoryBoard?",
        default: true,
        store: true,
      },
      {
        type: "confirm",
        name: "openExplorer",
        message: "Open explorer to show copied files?",
        default: true,
        store: true,
      },
    ]);
  }

  async writing() {
    const { sourcePath, outputPath } = this.answers;

    // Validate existence
    if (!fs.existsSync(sourcePath)) {
      this.log.error(`File not found: ${sourcePath}`);
      return;
    }

    const sourceRoot = path.dirname(sourcePath);
    const componentName = path.parse(sourcePath).name;
    const finalTarget = path.join(outputPath, componentName);

    const baseName = path.parse(sourcePath).name;
    this.log(`🚀 Analyzing ${baseName}...`);
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
      const relativeComponentPath = path
        .relative(commonBase, sourcePath)
        .replace(/\\/g, "/");

      this.log(
        `📍 Relative Component Path identified: ${relativeComponentPath}`,
      );

      // 3. Sync using the commonBase as the anchor
      // This prevents the ../../ from ever leaving the finalTarget folder
      syncDependencies(this, absoluteList, commonBase, finalTarget);

      await saveMadgeReports(res, finalTarget, componentName);

      this.log(`✅ Reports saved to: ${outputPath}`);
      // =============================================
      // Populate sandbox components
      // =============================================
      if (this.createSandBox) {
        this.log(`✅ Copying templates: ${componentName}`);
        this.packageJson.merge({
          name: `sandbox-${componentName}`,
          dependencies: {
            react: "^18.2.0",
            "react-dom": "^18.2.0",
            // Dynamically add more from the source project if needed
          },
          scripts: {
            dev: "vite",
            storybook: "storybook dev -p 6006",
          },
        });
        this.log(
          `Source Template: ${this.templatePath("sandbox/package.json")}`,
        );
        this.log(`Destination: ${path.join(finalTarget, "package.json")}`);

        this.fs.copyTpl(
          this.templatePath("Component.stories.jsx"),
          path.join(finalTarget, `${componentName}.stories.jsx`),
          {
            componentName,
            importPath: `./${relativeComponentPath}`, // Point to the extracted location
          },
        );

        // Copy the sandbox boilerplate
        this.fs.copyTpl(
          this.templatePath("sandbox/package.json"),
          path.join(finalTarget, "package.json"),
          { componentName },
        );

        this.fs.copyTpl(
          this.templatePath("sandbox/vite.config.js"),
          path.join(finalTarget, "vite.config.js"),
        );

        this.fs.copyTpl(
          this.templatePath("sandbox/index.html"),
          path.join(finalTarget, "index.html"),
          { componentName, relativeComponentPath },
        );

        await this.fs.commit(); // Forces Yeoman to write templates to disk NOW
      }
    } catch (err) {
      this.log.error(`Failed to process reports: ${err.message}`);
    }
  }
  async end() {
    const finalPath = path.join(
      this.answers.outputPath,
      path.parse(this.answers.sourcePath).name,
    );

    this.log("\n------------------------------------------");
    this.log("🎉 Extraction Complete!");
    this.log(`📁 Files are located at: ${finalPath}`);
    this.log("------------------------------------------\n");

    // open the folder for the user if requested
    if (this.answers.openExplorer) openExplorer(finalPath);
  }
}
