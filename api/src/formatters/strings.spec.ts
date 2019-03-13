import { loadFixture, simpleFormatFixture } from "./fixtures";
import { stringsParser, stringsExporter } from "./strings";

test('should parse strings files', async () => {
    const input = loadFixture('simple.strings');
    const result = await stringsParser(input);
    expect(result).toEqual(simpleFormatFixture);
});

test('should export strings files', async () => {
    const result = await stringsExporter(simpleFormatFixture);
    const expected = loadFixture('simple.strings');
    expect(result).toEqual(expected);
})