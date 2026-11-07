export function readVisibleAnchors({
  origin,
  maximum,
}: {
  origin: string;
  maximum: number;
}): string[] {
  const found: string[] = [];
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_ELEMENT,
  );
  let inspected = 0;
  while (walker.nextNode() && inspected++ < 1000 && found.length < maximum) {
    const element = walker.currentNode as Element;
    if (element.tagName !== "A" || element.hasAttribute("download")) continue;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (
      !rect.width ||
      !rect.height ||
      style.visibility !== "visible" ||
      style.display === "none" ||
      style.opacity === "0"
    )
      continue;
    try {
      const url = new URL(element.getAttribute("href") ?? "", document.baseURI);
      if (
        ["http:", "https:"].includes(url.protocol) &&
        url.origin === origin &&
        !url.username &&
        !url.password &&
        url.pathname.length <= 1000
      )
        found.push(url.pathname);
    } catch {
      /* Invalid anchors are not navigation candidates. */
    }
  }
  return found;
}
