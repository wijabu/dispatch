import { describe, expect, it } from "vitest";
import { redditWatchexchange } from "../reddit-watchexchange";
import { makeItem, makePhotos } from "./fixtures";

const watch = () => makeItem({
  name: "Citizen Promaster Land AT6080-53L",
  description: "Navy Promaster on Super Titanium. Radio-controlled.",
  askingPrice: 250,
  attributes: {
    Variant: "Blue Dial",
    Diameter: "39mm",
    Thickness: "11.4mm",
    "Lug Width": "22mm",
    "Water Resistance": "200m",
    "Condition Rating": "8.5/10",
    "Kit Contents": "Original box, papers, extra strap",
  },
});

describe("redditWatchexchange.generate", () => {
  it("title is title-only in Wil's pattern: [WTS] name - Variant - Full Kit", () => {
    expect(redditWatchexchange.generate(watch(), makePhotos(3)).title)
      .toBe("[WTS] Citizen Promaster Land AT6080-53L - Blue Dial - Full Kit");
  });

  it("opens the comment with the 'For your consideration' line and the imgur placeholders", () => {
    const { body } = redditWatchexchange.generate(watch(), makePhotos(3));
    expect(body).toContain("For your consideration today is the Citizen Promaster Land AT6080-53L - Full Kit");
    expect(body).toContain("[Photos](PHOTOS_ALBUM_URL) | [Timestamp](TIMESTAMP_ALBUM_URL)");
  });

  it("renders the labeled spec block with Wil's labels (Diameter->Case size, Lug Width->Lugs)", () => {
    const { body } = redditWatchexchange.generate(watch(), makePhotos(3));
    expect(body).toContain("Case size: 39mm");
    expect(body).toContain("Thickness: 11.4mm");
    expect(body).toContain("Lugs: 22mm");
    expect(body).toContain("Water Resistance: 200m");
    expect(body).toContain("Condition: 8.5/10");
    expect(body).toContain("Price/Shipping: $250 USD Shipped to CONUS by USPS.");
    expect(body).toContain("Includes Full Kit: Original box, papers, extra strap");
    expect(body).toContain("Payment Method: PayPal F&F or G&S Invoice (+4% paid by buyer)");
  });

  it("ends with Wil's fixed closer after the payment line", () => {
    const { body } = redditWatchexchange.generate(watch(), makePhotos(3));
    expect(body.endsWith("Not looking for any trades\n\nCheers")).toBe(true);
  });

  it("does NOT emit spec lines for attributes that have no value", () => {
    const { body } = redditWatchexchange.generate(makeItem({ name: "Seiko SRPD", attributes: { Diameter: "42mm" } }), makePhotos(1));
    expect(body).toContain("Case size: 42mm");
    expect(body).not.toContain("Thickness:");
    expect(body).not.toContain("Lugs:");
  });

  it("omits the price line and warns when there is no asking price", () => {
    const noPrice = makeItem({ name: "Orient", askingPrice: null, attributes: {} });
    const { body, warnings } = redditWatchexchange.generate(noPrice, makePhotos(1));
    expect(body).not.toContain("Price/Shipping:");
    expect(warnings).toContain("No asking price set");
  });

  it("honors a non-default Kit override in title and comment", () => {
    const headOnly = makeItem({ name: "Tudor BB58", attributes: { Kit: "Head Only" } });
    const { title, body } = redditWatchexchange.generate(headOnly, makePhotos(1));
    expect(title).toBe("[WTS] Tudor BB58 - Head Only");
    expect(body).toContain("Includes Head Only:");
  });

  it("joins the stat block with Markdown hard breaks so Reddit keeps each line", () => {
    const { body } = redditWatchexchange.generate(watch(), makePhotos(1));
    // two trailing spaces + newline between stat lines (a bare \n collapses on Reddit)
    expect(body).toContain("Case size: 39mm  \nThickness: 11.4mm");
    expect(body).not.toContain("Case size: 39mm\nThickness");
  });

  it("passes the description through as written — no sentence-splitting", () => {
    const item = makeItem({ description: "First sentence. Second sentence. Third one.", attributes: {} });
    const { body } = redditWatchexchange.generate(item, makePhotos(1));
    expect(body).toContain("First sentence. Second sentence. Third one.");
    expect(body).not.toContain("First sentence.\n\nSecond sentence.");
  });
});

describe("redditWatchexchange photo links", () => {
  it("uses the Photos Album and Timestamp attributes when set", () => {
    const item = makeItem({ attributes: { "Photos Album": "https://imgur.com/a/AAA", "Timestamp": "https://i.imgur.com/BBB.jpeg" } });
    const { body } = redditWatchexchange.generate(item, makePhotos(1));
    expect(body).toContain("[Photos](https://imgur.com/a/AAA) | [Timestamp](https://i.imgur.com/BBB.jpeg)");
  });

  it("falls back to placeholders when the links are unset", () => {
    const { body } = redditWatchexchange.generate(makeItem({ attributes: {} }), makePhotos(1));
    expect(body).toContain("[Photos](PHOTOS_ALBUM_URL) | [Timestamp](TIMESTAMP_ALBUM_URL)");
  });

  it("does not render the link attributes as spec/other lines", () => {
    const item = makeItem({ attributes: { "Photos Album": "https://imgur.com/a/AAA", "Timestamp": "https://i.imgur.com/BBB.jpeg" } });
    const { body } = redditWatchexchange.generate(item, makePhotos(1));
    expect(body).not.toContain("Photos Album: https");
    expect(body).not.toContain("Timestamp: https");
  });
});
