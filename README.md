# generator-madge-capture
A yeoman generator to extract a React component's dependencies and create a storybook project OR add the component to an existing storybook project OR make a standalone dependency folder structure for the component.

If the file is determined to be a React component it is renamed with the .jsx extension so it can be run in storybook.
A file is considered to be a component based on this regex check:
```
isReactFile =
  /import.*React/i.test(content) ||
  /<[A-Z]/.test(content) ||
  /return\s*\(/.test(content);
```

The resulting file structure will emulate the dependency tree of the original component:
```
|   
+---Components
|   +---Buttons
|   |   +---Button
|   |       |   Button.jsx
|   |       |   Button.perf.test.js
|   |       |   Button.snapshot.test.js
|   |       |   Button.stories.jsx
|   |       |   Button.unit.test.js
|   |       |   buttonPropTypes.js
|   |       |   
|   |       +---__snapshots__
|   |               Button.snapshot.test.js.snap
|   |               
|   +---CardWrapper
|       |   CardWrapper.json
|       |   CardWrapper.md
|       |   CardWrapper.stories.jsx
|       |   
|       +---React
|       |   +---Components
|       |   |   +---Layout
|       |   |       +---Containers
|       |   |       |       CardWrapper.jsx
|       |   |       |       
|       |   |       +---Error
|       |   |       |       DefaultErrorBoundary.jsx
|       |   |       |       
|       |   |       +---Messages
|       |   |               DefaultErrorMessage.jsx
|       |   |               MessageStyles.js
|       |   |               
|       |   +---Data
|       |           customPropTypes.js
|       |           
|       +---utils
|               logger.js
|               
+---Hooks
|       useFocusWhenVisible.js
|       useOnScreen.js
|       
+---Types
        childNodePropType.js

```

The instructions for installing Yeoman can be found [here](https://yeoman.io/learning/) but basically it's as simple as 
`npm install -g yo`

To run this generator run `yo madge-capture` then answer the prompts:

? Enter the location of the component: (C:\code\React\Components\Layout\Containers\CardWrapper.js)

You then have 3 options to choose from:
```
? How do you want to export this component?
  Create a new Storybook Project                        ← Complete storybook project for the component
❯ Add to an existing Storybook Project                  ← Add component to an existing storybook project
  Create component dependency folder and files only     ← Recreate the depencency tree for the component
```
You will be prompted for an output folder:
```
? Where do you want to save the output files? (C:\Users\UserName\madge-capture)
```
If you elected to create a standalone storybook project, you will be asked if you want to create the project:
```
? Create sandbox files to run in StoryBoard? (Y/n)
? Open explorer to show copied files? (y/N)             ← Opens your file explorer to view the newly copied component
```
The generator then provides instructions on how to run your storybook project if that option was chosen.
