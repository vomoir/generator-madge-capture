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
 * @param {Object} aliasMap - Map of aliases to their target paths
 */
export const syncDependencies = (
  gen,
  absolutePaths,
  sourceRoot,
  targetDir,
  aliasMap = {},
) => {
  let copiedCount = 0;
  let missingCount = 0;

  absolutePaths.forEach((srcPath) => {
    try {
      // Check if file exists
      if (!fs.existsSync(srcPath)) {
        gen.log.error(`File missing (skipped): ${srcPath}`);
        missingCount++;
        return;
      }

      // Determine relative path from the source component
      // e.g., if sourceRoot is .../Form and srcPath is .../utils/date.js
      // relativePart will be "../../utils/date.js"
      const relativePart = path.relative(sourceRoot, srcPath).replace(/\\/g, "/");

      // Create the final destination path
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

      // The Regex Import Renamer
      // Matches relative imports like ./file or ../../file
      const importRegex = /(from|import)\s+(['"])((\.\.?\/)+[^'"]*)(['"])/g;

      // We only perform the replacement on JS/JSX files
      if (srcPath.match(/\.(js|jsx)$/)) {
        const currentFileDir = path.dirname(relativePart);

        content = content.replace(importRegex, (match, p1, p2, p3, p4, p5) => {
          let importPath = p3;

          // 1. Rename .js to .jsx in the import string if needed
          if (importPath.endsWith(".js")) {
            importPath = importPath.replace(/\.js$/, ".jsx");
          }

          // 2. Alias Replacement Logic
          // Resolve the import path relative to the current file to get the path from sourceRoot
          const resolvedPath = path.posix.join(currentFileDir, importPath);
          const normalizedResolvedPath = path.posix.normalize(resolvedPath);

          for (let [alias, target] of Object.entries(aliasMap)) {
            // Normalize target: posix separators, no leading slash
            let normalizedTarget = target.replace(/\\/g, "/").replace(/^\//, "");

            // If the target starts with "src/" and our path doesn't,
            // we might be inside the src folder already.
            // Let's also try matching without "src/" if commonBase is likely "src"
            const targetsToTry = [normalizedTarget];
            if (normalizedTarget.startsWith("src/")) {
              targetsToTry.push(normalizedTarget.replace(/^src\//, ""));
            }

            for (const t of targetsToTry) {
              if (
                normalizedResolvedPath === t ||
                normalizedResolvedPath.startsWith(t + "/")
              ) {
                let remaining = normalizedResolvedPath.slice(t.length);
                if (remaining.startsWith("/")) remaining = remaining.slice(1);

                // Construct the new aliased path
                let newImport = alias;
                if (remaining) {
                  // If alias ends with /, don't add another /
                  if (newImport.endsWith("/")) {
                    newImport += remaining;
                  } else {
                    // Special case for @/ which usually doesn't need a / if remaining starts with one
                    // but we normalized remaining to NOT start with /
                    newImport += "/" + remaining;
                  }
                }
                
                // Clean up any double slashes from @//
                newImport = newImport.replace(/\/+/g, '/').replace(/\/$/, '');
                // But keep @/ if it was intended
                if (alias === '@/' && !newImport.startsWith('@/')) {
                    newImport = '@/' + newImport.replace(/^@/, '');
                }

                return `${p1} ${p2}${newImport}${p5}`;
              }
            }
          }

          return `${p1} ${p2}${importPath}${p5}`;
        });
      }
      // Ensure destination folder exists
      const destFolder = path.dirname(destPath);
      if (!fs.existsSync(destFolder)) {
        fs.mkdirSync(destFolder, { recursive: true });
      }

      // Perform the copy
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
 * Finds the nearest jsconfig.json or tsconfig.json and extracts alias paths
 * @param {string} startPath - Directory to start searching from
 * @returns {Object} - Alias map (e.g., { '@Components': 'src/Components' })
 */
export const getSourceAliases = (startPath) => {
  let currentDir = startPath;
  let foundPath = null;
  const configFiles = ["jsconfig.json", "tsconfig.json"];

  // 1. Climb up to find nearest config
  while (currentDir !== path.parse(currentDir).root) {
    for (const file of configFiles) {
      const checkPath = path.join(currentDir, file);
      if (fs.existsSync(checkPath)) {
        foundPath = checkPath;
        break;
      }
    }
    if (foundPath) break;
    currentDir = path.dirname(currentDir);
  }

  if (!foundPath) return {};

  try {
    // Basic JSON parse (ignoring potential comments for now)
    const config = JSON.parse(fs.readFileSync(foundPath, "utf8"));
    const paths = config?.compilerOptions?.paths;
    if (!paths) return {};

    const aliases = {};
    Object.entries(paths).forEach(([key, values]) => {
      // Key might be "@/*" or "@Components"
      // Values is usually ["src/*"] or ["src/Components"]
      const alias = key.replace(/\/\*$/, "");
      let target = values[0].replace(/\/\*$/, "");
      
      // We want the target relative to the config file
      // If baseUrl is set, it should be relative to that, but often it's just ./
      aliases[alias] = target;
    });
    return aliases;
  } catch (err) {
    return {};
  }
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
