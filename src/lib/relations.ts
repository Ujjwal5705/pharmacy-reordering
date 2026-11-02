const RELATION: Record<string, string> = {
  SELF: "Myself",
  MOTHER: "Mother",
  FATHER: "Father",
  SPOUSE: "Spouse",
  CHILD: "Child",
  SIBLING: "Sibling",
  GRANDPARENT: "Grandparent",
  OTHER: "Family",
};

export const relationLabel = (r: string) => RELATION[r] ?? "Family";
