/* terraforge-plugin
{
  "id": "examples.reverse-vectors",
  "name": "Reverse Vectors",
  "version": "1.0.0",
  "apiVersion": 1,
  "description": "Create a separate vector result with reversed path order and direction.",
  "category": "generator",
  "input": "vector",
  "outputs": ["vector"]
}
*/
export default function run(input, parameters, context) {
  context.progress(100);
  return { width: input.width, height: input.height,
    paths: [...input.paths].reverse().map((path) => ({ ...path, points: [...path.points].reverse() })) };
}
