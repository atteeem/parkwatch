// Proves the Jest runner (jest-expo preset) is wired up and transpiles TypeScript.
describe("test runner", () => {
  it("runs a TypeScript test", () => {
    const sum = (a: number, b: number): number => a + b;
    expect(sum(2, 3)).toBe(5);
  });
});
