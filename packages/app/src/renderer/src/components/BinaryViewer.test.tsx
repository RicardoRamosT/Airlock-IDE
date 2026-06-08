// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BinaryNotice } from "./BinaryNotice";
import { ImagePreview } from "./ImagePreview";

let readImageDataUrl: ReturnType<typeof vi.fn>;
let openExternalFile: ReturnType<typeof vi.fn>;

beforeEach(() => {
  readImageDataUrl = vi.fn(() =>
    Promise.resolve({ dataUrl: "data:image/png;base64,AAA", tooLarge: false }),
  );
  openExternalFile = vi.fn(() => Promise.resolve());
  window.airlock = new Proxy(
    { readImageDataUrl, openExternalFile },
    {
      get: (t, p) =>
        p in t
          ? (t as Record<string, unknown>)[p as string]
          : () => Promise.resolve(undefined),
    },
  ) as unknown as typeof window.airlock;
});
afterEach(() => cleanup());

it("ImagePreview renders the fetched data URL", async () => {
  const { container } = render(<ImagePreview root="/r" relPath="a.png" />);
  await waitFor(() => {
    const img = container.querySelector(
      "img.image-preview",
    ) as HTMLImageElement;
    expect(img?.getAttribute("src")).toBe("data:image/png;base64,AAA");
  });
  expect(readImageDataUrl).toHaveBeenCalledWith("/r", "a.png");
});

it("ImagePreview shows Open externally when too large", async () => {
  readImageDataUrl.mockReturnValueOnce(
    Promise.resolve({ dataUrl: "", tooLarge: true }),
  );
  const { findByText } = render(<ImagePreview root="/r" relPath="big.png" />);
  fireEvent.click(await findByText("Open externally"));
  expect(openExternalFile).toHaveBeenCalledWith("/r", "big.png");
});

it("BinaryNotice shows a formatted size and opens externally", () => {
  const { getByText } = render(
    <BinaryNotice root="/r" relPath="a.zip" size={1_500_000} />,
  );
  expect(getByText(/1\.4 MB/)).toBeTruthy();
  fireEvent.click(getByText("Open externally"));
  expect(openExternalFile).toHaveBeenCalledWith("/r", "a.zip");
});
