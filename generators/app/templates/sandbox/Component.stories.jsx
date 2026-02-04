import Component from "./<%= relativeComponentPath %>";

export default {
  title: "Extracted/<%= componentName %>",
  component: Component,
  tags: ["autodocs"], // This tells Storybook to build the prop table automatically
  argTypes: {
    // You can manually override prop controls here if needed
  },
};

export const Primary = {
  args: {
    // You can set default prop values here
    // label: 'Click Me',
    // primary: true,
  },
};
