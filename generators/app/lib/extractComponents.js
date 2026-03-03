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
 * helper that attempts to convert a path (normalized *relative* to
 * sourceRoot) into one of the configured aliases. returns the aliased
 * string or null if none of the aliases matched.
 */
const tryAlias = (normalizedPath, aliasMap) => {
  // Sort aliases by length descending to match most specific first
  // We want to match '@Components/Form' before '@Components'
  const sortedAliases = Object.entries(aliasMap).sort(
    (a, b) => b[1].length - a[1].length,
  );

  for (const [alias, target] of sortedAliases) {
    // target is already relative to commonBase and normalized (no leading/trailing slashes)
    const normalizedTarget = target.replace(/^\.\/|\/$/g, "");

    const isMatch =
      normalizedTarget === "" || // Root alias (e.g. @/ -> src/)
      normalizedPath === normalizedTarget ||
      normalizedPath.startsWith(normalizedTarget + "/");

    if (isMatch) {
      let remaining = normalizedPath.slice(normalizedTarget.length);
      if (remaining.startsWith("/")) remaining = remaining.slice(1);

      // Construct the new aliased path
      let newImport = alias;
      
      if (remaining) {
        // If alias ends with /, don't add another /
        if (newImport.endsWith("/")) {
          newImport += remaining;
        } else {
          newImport += "/" + remaining;
        }
      }

      // Clean up any double slashes from @// (except for @/)
      if (newImport !== "@/") {
          newImport = newImport.replace(/\/+/g, "/");
      }
      
      // Ensure it doesn't end with a slash unless it's just the alias itself
      if (newImport.length > alias.length && newImport.endsWith("/")) {
          newImport = newImport.slice(0, -1);
      }

      return newImport;
    }
  }
  return null;
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
      if (!fs.existsSync(srcPath)) {
        gen.log.error(`File missing (skipped): ${srcPath}`);
        missingCount++;
        return;
      }

      // Determine relative path from the sourceRoot (commonBase)
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

      // Matches any import/export from a string literal.
      // Captures: (keyword)(content between keyword and quote)(quote)(path)(closing quote)
      // This preserves destructured imports like { childNodeType } from '...'
      const importRegex = /(from|import|export)([\s\S]*?)(['"])([^'"]+)\3/g;

      if (srcPath.match(/\.(js|jsx|ts|tsx)$/)) {
        const currentFileDir = path.dirname(relativePart);

        content = content.replace(importRegex, (match, p1, p2, p3, p4) => {
          let importPath = p4;

          // We only want to rewrite relative paths
          if (!importPath.startsWith("./") && !importPath.startsWith("../")) {
            return match;
          }

          // rename .js files to .jsx if we converted them earlier
          if (importPath.endsWith(".js")) {
            const resolvedAbs = path.resolve(path.dirname(srcPath), importPath);
            if (fs.existsSync(resolvedAbs)) {
                const subContent = fs.readFileSync(resolvedAbs, "utf8");
                if (/<[A-Z]/.test(subContent) || /import.*React/i.test(subContent)) {
                    importPath = importPath.replace(/\.js$/, ".jsx");
                }
            }
          }

          // Resolve the import path relative to the current file to get the path relative to commonBase
          const normalizedResolvedPath = path.posix.normalize(path.posix.join(currentFileDir, importPath));

          const aliased = tryAlias(normalizedResolvedPath, aliasMap);
          if (aliased) {
            return `${p1}${p2}${p3}${aliased}${p3}`;
          }

          return `${p1}${p2}${p3}${importPath}${p3}`;
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
 * Recursively walks a directory and rewrites imports in JS/JSX files
 * @param {Generator} gen 
 * @param {string} rootDirectory - The base directory to resolve everything relative to
 * @param {string} currentDir - The current directory being walked
 * @param {Object} aliasMap 
 * @param {string} commonBase - The commonBase directory used to calculate aliasMap targets
 */
const rewriteRecursive = (gen, rootDirectory, currentDir, aliasMap, commonBase) => {
  const files = fs.readdirSync(currentDir);

  files.forEach((file) => {
    const fullPath = path.join(currentDir, file);
    if (fs.lstatSync(fullPath).isDirectory()) {
      rewriteRecursive(gen, rootDirectory, fullPath, aliasMap, commonBase);
    } else if (fullPath.match(/\.(js|jsx|ts|tsx)$/)) {
      let content = fs.readFileSync(fullPath, "utf8");
      
      // Measure the file's path relative to the commonBase (where aliasMap targets are defined)
      const relativeToFile = path.relative(commonBase, fullPath).replace(/\\/g, "/");
      const relativeToRoot = path.dirname(relativeToFile);

      // Captures: (keyword)(content between keyword and quote)(quote)(path)
      // This preserves destructured imports like { childNodeType } from '...'
      const importRegex = /(from|import|export)([\s\S]*?)(['"])([^'"]+)\3/g;

      const newContent = content.replace(importRegex, (match, p1, p2, p3, p4) => {
        let importPath = p4;
        
        // We only want to rewrite relative paths
        if (!importPath.startsWith("./") && !importPath.startsWith("../")) {
            return match;
        }

        // Resolve the import path relative to the current file (relative to commonBase)
        const normalizedResolvedPath = path.posix.normalize(path.posix.join(relativeToRoot, importPath));

        const aliased = tryAlias(normalizedResolvedPath, aliasMap);
        if (aliased) {
          return `${p1}${p2}${p3}${aliased}${p3}`;
        }

        return match;
      });

      if (newContent !== content) {
        fs.writeFileSync(fullPath, newContent);
      }
    }
  });
};

export const rewriteImportsInDirectory = (gen, directory, aliasMap, commonBase) => {
  if (Object.keys(aliasMap).length === 0) return;
  rewriteRecursive(gen, directory, directory, aliasMap, commonBase);
};

/**
 * Finds the shortest common parent directory for an array of absolute paths.
 */
export const findCommonBase = (files) => {
  if (files.length === 0) return "";

  const isWin = process.platform === "win32";

  // Split paths into segments
  const splitPaths = files.map((f) => f.split(path.sep));
  let common = splitPaths[0];

  for (let i = 1; i < splitPaths.length; i++) {
    let j = 0;
    while (
      j < common.length &&
      j < splitPaths[i].length &&
      (isWin 
        ? common[j].toLowerCase() === splitPaths[i][j].toLowerCase() 
        : common[j] === splitPaths[i][j])
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
  const allAvailable = { 
    ...pkg.devDependencies, 
    ...pkg.dependencies,
    ...pkg.peerDependencies
  };

  const results = {};
  depNames.forEach((name) => {
    if (allAvailable[name]) {
      results[name] = allAvailable[name];
    }
  });

  return results;
};

/**
 * Finds the nearest package.json to identify the project root
 */
export const findProjectRoot = (startPath) => {
  let currentDir = startPath;
  while (currentDir !== path.parse(currentDir).root) {
    if (fs.existsSync(path.join(currentDir, "package.json"))) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }
  return startPath;
};

/**
 * Helper to strip comments from JSON strings
 */
const stripComments = (text) => {
  return text.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, "");
};

/**
 * Finds the nearest config file and extracts alias paths
 * @param {Generator} gen - For logging
 * @param {string} startPath - Directory to start searching from
 * @returns {Object} - Alias map with absolute target paths
 */
export const getSourceAliases = (gen, startPath) => {
  let currentDir = startPath;
  let foundPath = null;
  const configFiles = ["aliases.json", "jsconfig.json", "tsconfig.json"];

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

  if (!foundPath) {
    gen.log("ℹ️ No alias config files found (looked for aliases.json, jsconfig.json, tsconfig.json).");
    return {};
  }

  gen.log(`📖 Found alias config at: ${foundPath}`);

  try {
    const rawContent = fs.readFileSync(foundPath, "utf8");
    const config = JSON.parse(stripComments(rawContent));
    const configDir = path.dirname(foundPath);
    const aliases = {};

    const fileName = path.basename(foundPath);
    if (fileName === "aliases.json") {
      Object.entries(config).forEach(([alias, target]) => {
        // Handle leading slashes by resolving relative to configDir
        const cleanTarget = target.replace(/^[\\\/]/, "");
        aliases[alias] = path.resolve(configDir, cleanTarget);
      });
    } else {
      const paths = config?.compilerOptions?.paths;
      if (paths) {
        Object.entries(paths).forEach(([key, values]) => {
          const alias = key.replace(/\/\*$/, "");
          let target = values[0].replace(/\/\*$/, "");
          const cleanTarget = target.replace(/^[\\\/]/, "");
          aliases[alias] = path.resolve(configDir, cleanTarget);
        });
      }
    }
    return aliases;
  } catch (err) {
    gen.log.error(`❌ Error parsing ${foundPath}: ${err.message}`);
    return {};
  }
};

/**
 * Auto-generates aliases from the discovered folder structure
 * Analyzes the absolute file list and creates aliases for top-level directories
 * that appear frequently in imports
 * @param {string} commonBase - The common base directory
 * @param {string[]} absolutePaths - Array of absolute paths to analyze
 * @returns {Object} - Map of aliases to their absolute paths
 */
export const generateAliasesFromStructure = (commonBase, absolutePaths) => {
  const aliases = {};
  const dirCounts = {};
  
  // Count first-level directories under commonBase
  absolutePaths.forEach((filePath) => {
    const relative = path.relative(commonBase, filePath).replace(/\\/g, "/");
    const parts = relative.split("/");
    if (parts.length > 1) {
      const firstDir = parts[0];
      dirCounts[firstDir] = (dirCounts[firstDir] || 0) + 1;
    }
  });
  
  // Create aliases for directories with multiple files (appears frequently)
  Object.entries(dirCounts).forEach(([dir, count]) => {
    if (count >= 2) { // Only create aliases for dirs with 2+ files
      const dirPath = path.resolve(commonBase, dir);
      if (fs.existsSync(dirPath) && fs.lstatSync(dirPath).isDirectory()) {
        aliases[`@${dir}`] = dirPath;
      }
    }
  });
  
  return aliases;
};

/**
 * Validates that aliases are properly configured and used in imports
 * @param {Generator} gen - The Yeoman generator instance for logging
 * @param {string} targetDirectory - The extraction directory to validate
 * @returns {Object} - Validation results with summary and details
 */
export const validateAliases = (gen, targetDirectory) => {
  const results = {
    aliasesConfigured: false,
    aliasCount: 0,
    filesWithAliasedImports: 0,
    filesWithRelativeImports: 0,
    totalFilesScanned: 0,
    details: []
  };

  try {
    // 1. Check jsconfig.json
    const jsconfigPath = path.join(targetDirectory, "jsconfig.json");
    if (!fs.existsSync(jsconfigPath)) {
      results.details.push("⚠️ No jsconfig.json found");
      return results;
    }

    const jsconfigContent = fs.readFileSync(jsconfigPath, "utf8");
    const jsconfig = JSON.parse(jsconfigContent);
    const aliases = jsconfig?.compilerOptions?.paths || {};
    const aliasKeys = Object.keys(aliases);

    results.aliasesConfigured = aliasKeys.length > 0;
    results.aliasCount = aliasKeys.length;

    if (results.aliasCount === 0) {
      results.details.push("⚠️ No aliases configured in jsconfig.json");
      return results;
    }

    results.details.push(`✅ Found ${results.aliasCount} aliases configured:`);
    aliasKeys.forEach((alias) => {
      results.details.push(`   ${alias} -> ${aliases[alias][0]}`);
    });

    // 2. Scan all JS/JSX/TS/TSX files for import usage
    const scanDirectory = (dir) => {
      const files = fs.readdirSync(dir);
      files.forEach((file) => {
        const fullPath = path.join(dir, file);
        const stat = fs.lstatSync(fullPath);

        if (stat.isDirectory() && !["node_modules", "dist", ".storybook"].includes(file)) {
          scanDirectory(fullPath);
        } else if (stat.isFile() && fullPath.match(/\.(js|jsx|ts|tsx)$/)) {
          results.totalFilesScanned++;
          const content = fs.readFileSync(fullPath, "utf8");

          // Check for aliased imports
          const aliasedImports = [];
          aliasKeys.forEach((alias) => {
            const cleanAlias = alias.replace(/\/\*$/, "");
            if (new RegExp(`from\\s+['"]${cleanAlias}[/'"]`).test(content)) {
              aliasedImports.push(cleanAlias);
            }
          });

          if (aliasedImports.length > 0) {
            results.filesWithAliasedImports++;
          }

          // Check for relative imports (these might be fine, but worth noting)
          if (/from\s+['"]\.\.?\//g.test(content)) {
            results.filesWithRelativeImports++;
          }
        }
      });
    };

    scanDirectory(targetDirectory);

    results.details.push(`\n📊 Import Analysis:`);
    results.details.push(`   Files scanned: ${results.totalFilesScanned}`);
    results.details.push(`   Using aliases: ${results.filesWithAliasedImports}`);
    if (results.filesWithRelativeImports > 0) {
      results.details.push(`   Still using relative: ${results.filesWithRelativeImports}`);
    }

    if (results.filesWithAliasedImports > 0) {
      results.details.push(`\n✨ Aliases are working!`);
    } else if (results.filesWithRelativeImports > 0) {
      results.details.push(`\n⚠️ Aliases configured but not yet used in imports`);
    }

  } catch (err) {
    results.details.push(`❌ Validation error: ${err.message}`);
  }

  return results;
};

/**
 * Opens a folder in the native OS file explorer
 * @param {string} folderPath
 */
export const openExplorer = (folderPath) => {
  exec(`explorer "${folderPath}"`, (err) => {
    if (err) {
      console.error(`Could not open explorer: ${err.message}`);
    }
  });
};
