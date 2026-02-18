export const getPrompts = (defaultCaptureBase) => [
  {
    type: "input",
    name: "sourcePath",
    message: "Enter the location of the component:",
    default: "D:\\Web.Application\\React\\Components\\Form.js",
    store: true,
  },
  {
    type: "list",
    name: "mode",
    message: "How do you want to export this component?",
    choices: [
      { name: "Create a new Storybook Project", value: "new" },
      { name: "Add to an existing Storybook Project", value: "existing" },
      {
        name: "Create component dependency folder and files only",
        value: "dependency_only",
      },
    ],
    default: "new",
    store: true,
  },
  {
    type: "input",
    name: "outputPath",
    message: "Where do you want to save the output files?",
    default: defaultCaptureBase,
    when: (answers) =>
      answers.mode === "new" || answers.mode === "dependency_only",
    store: true,
  },
  {
    type: "input",
    name: "existingProjectPath",
    message: "Enter the root path of your existing project:",
    when: (answers) => answers.mode === "existing",
    store: true,
  },
  {
    type: "input",
    name: "componentSubDir",
    message: "Sub-directory for the component (relative to project root):",
    default: "src/components",
    when: (answers) => answers.mode === "existing",
    store: true,
  },
  {
    type: "confirm",
    name: "createSandBox",
    message: "Create sandbox files to run in StoryBoard?",
    default: true,
    when: (answers) => answers.mode === "new",
    store: true,
  },
  {
    type: "confirm",
    name: "openExplorer",
    message: "Open explorer to show copied files?",
    default: true,
    store: true,
  },
];
