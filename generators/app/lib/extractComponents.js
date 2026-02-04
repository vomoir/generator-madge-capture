import path from "path";
import fs from "fs";
import { exec } from "child_process";

export const extractComponent = (
  generator,
  madgeObj,
  sourceFile,
  targetDir,
) => {
  const sourceRoot = path.dirname(sourceFile);

  // 1. Get all unique file paths from Madge (keys and values)
  const allFiles = new Set([sourceFile]);
  Object.entries(madgeObj).forEach(([file, deps]) => {
    // Madge paths are relative to the sourceFile directory
    allFiles.add(path.resolve(sourceRoot, file));
    deps.forEach((dep) => allFiles.add(path.resolve(sourceRoot, dep)));
  });

  generator.log(`Found ${allFiles.size} total files to extract.`);

  // 2. Copy files and maintain structure
  allFiles.forEach((absolutePath) => {
    if (fs.existsSync(absolutePath) && fs.lstatSync(absolutePath).isFile()) {
      // Calculate where it should go in the target
      // We want to keep the relative relationship it had with the sourceRoot
      const relativeToRoot = path.relative(sourceRoot, absolutePath);
      const destination = path.join(targetDir, relativeToRoot);

      // Use Yeoman's file system (standard fs works too for external paths)
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(absolutePath, destination);
    }
  });
};

export const getAbsoluteFiles = (dependencyJson, sourceFile) => {
  const sourceDir = path.dirname(sourceFile);
  const uniquePaths = new Set();

  Object.entries(dependencyJson).forEach(([key, deps]) => {
    // 1. Resolve the 'key' (the file itself)
    // path.resolve automatically handles those ../../ and gives a clean D:\ path
    uniquePaths.add(path.resolve(sourceDir, key));

    // 2. Resolve every dependency listed for that file
    deps.forEach((dep) => {
      uniquePaths.add(path.resolve(sourceDir, dep));
    });
  });

  return Array.from(uniquePaths);
};

/**
 * Copies dependency files while preserving folder structure.
 * @param {Generator} gen - The Yeoman generator instance for logging
 * @param {string[]} absolutePaths - Array of resolved absolute source paths
 * @param {string} sourceRoot - The directory of the entry component (D:\...\Form)
 * @param {string} targetDir - The destination root (C:\...\madge-capture\Form)
 */
export const syncDependencies = (gen, absolutePaths, sourceRoot, targetDir) => {
  let copiedCount = 0;
  let missingCount = 0;

  absolutePaths.forEach((srcPath) => {
    try {
      // 1. Check if file exists
      if (!fs.existsSync(srcPath)) {
        gen.log.error(`File missing (skipped): ${srcPath}`);
        missingCount++;
        return;
      }

      // 2. Determine relative path from the source component
      // e.g., if sourceRoot is .../Form and srcPath is .../utils/date.js
      // relativePart will be "../../utils/date.js"
      const relativePart = path.relative(sourceRoot, srcPath);

      // 3. Create the final destination path
      let destPath = path.join(targetDir, relativePart);
      let content = fs.readFileSync(srcPath, "utf8");
      let isReactFile = false;

      // --- Extension Logic ---
      if (srcPath.endsWith(".js")) {
        isReactFile =
          /import.*React/i.test(content) ||
          /<[A-Z]/.test(content) ||
          /return\s*\(/.test(content);
        if (isReactFile) {
          destPath = destPath.replace(/\.js$/, ".jsx");
        }
      }
      // 2. The Regex Import Renamer
      // This regex looks for:
      // - Strings starting with 'from' or 'import'
      // - Followed by a quote (' or ")
      // - Followed by a relative path (./ or ../)
      // - Ending with .js before the closing quote
      const importRegex = /(from|import)\s+(['"])((\.\.?\/)+.*)\.js(['"])/g;
      // We only perform the replacement on JS/JSX files
      if (srcPath.match(/\.(js|jsx)$/)) {
        content = content.replace(importRegex, (match, p1, p2, p3, p4, p5) => {
          // We check if the file being imported is one of the ones we are extracting
          // For simplicity, we assume if it's a relative import, it needs the .jsx swap
          return `${p1} ${p2}${p3}.jsx${p5}`;
        });
      }
      // if (srcPath.match(/\.(js|jsx)$/)) {
      //   content = content.replace(
      //     /import\s+\{([^}]*ToastOptions[^}]*)\}\s+from\s+['"]react-hot-toast['"]/g,
      //     (match, p1) => {
      //       // Remove ToastOptions from the curly braces
      //       const cleaned = p1
      //         .split(",")
      //         .filter((item) => !item.includes("ToastOptions"))
      //         .join(",");
      //       return cleaned.trim()
      //         ? `import { ${cleaned} } from 'react-hot-toast'`
      //         : `// Removed empty type import`;
      //     },
      //   );
      // }
      // 4. Ensure destination folder exists
      const destFolder = path.dirname(destPath);
      if (!fs.existsSync(destFolder)) {
        fs.mkdirSync(destFolder, { recursive: true });
      }

      // 5. Perform the copy
      // We use writeFileSync instead of copyFileSync to save our modified content
      fs.writeFileSync(destPath, content);
      copiedCount++;
    } catch (err) {
      gen.log.error(`Failed to copy ${srcPath}: ${err.message}`);
    }
  });

  gen.log(`\nFinal Sync Report:`);
  gen.log(`✅ Copied: ${copiedCount}`);
  if (missingCount > 0) gen.log(`⚠️ Missing: ${missingCount}`);
};
/**
 * Finds the shortest common parent directory for an array of absolute paths.
 */
export const findCommonBase = (files) => {
  if (files.length === 0) return "";

  // Split paths into segments
  const splitPaths = files.map((f) => f.split(path.sep));
  let common = splitPaths[0];

  for (let i = 1; i < splitPaths.length; i++) {
    let j = 0;
    while (
      j < common.length &&
      j < splitPaths[i].length &&
      common[j] === splitPaths[i][j]
    ) {
      j++;
    }
    common = common.slice(0, j);
  }
  return common.join(path.sep);
};

/**
 * Finds the nearest package.json and extracts versions for requested deps
 * @param {string} startPath - Directory to start searching from
 * @param {string[]} depNames - Array of package names to find
 * @returns {Object} - Key/Value pair of package names and versions
 */
export const getSourceVersions = (startPath, depNames) => {
  let currentDir = startPath;
  let foundPath = null;

  // 1. Climb up the tree to find the nearest package.json
  while (currentDir !== path.parse(currentDir).root) {
    const checkPath = path.join(currentDir, "package.json");
    if (fs.existsSync(checkPath)) {
      foundPath = checkPath;
      break;
    }
    currentDir = path.dirname(currentDir);
  }

  if (!foundPath) return {};

  const pkg = JSON.parse(fs.readFileSync(foundPath, "utf8"));
  const allAvailable = { ...pkg.devDependencies, ...pkg.dependencies };

  const results = {};
  depNames.forEach((name) => {
    if (allAvailable[name]) {
      results[name] = allAvailable[name];
    }
  });

  return results;
};

/**
 * Opens a folder in the native OS file explorer
 * @param {string} folderPath
 */
export const openExplorer = (folderPath) => {
  // On Windows, 'explorer' is the command.
  // We wrap the path in quotes to handle spaces in folder names.
  exec(`explorer "${folderPath}"`, (err) => {
    if (err) {
      console.error(`Could not open explorer: ${err.message}`);
    }
  });
};
