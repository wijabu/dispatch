// Optional attribute suggestions surfaced as tap-to-add chips when a
// category is selected. Purely additive UI sugar — nothing is required.
export const CATEGORY_SUGGESTIONS: Record<string, string[]> = {
  watches: ["Brand", "Model", "Reference", "Movement", "Diameter", "Box/Papers", "Accessories", "Year"],
  furniture: ["Dimensions", "Material", "Brand"],
  electronics: ["Brand", "Model", "Storage", "Screen Size", "Year"],
  clothing: ["Brand", "Size", "Color", "Material"],
  tools: ["Brand", "Model", "Power Source"],
};
