const STEM_MARKDOWN_CONTAINER_STYLE = [
  "line-height:1.8",
  "font-size:30rpx",
  "color:#0f172a",
  "word-break:break-word",
].join(";");

const OPTION_MARKDOWN_CONTAINER_STYLE = [
  "line-height:1.8",
  "font-size:28rpx",
  "color:#334155",
  "word-break:break-word",
].join(";");

const STEM_MARKDOWN_TAG_STYLE = {
  p: "margin:0 0 18rpx;line-height:1.8;font-size:30rpx;color:#0f172a;",
  div: "line-height:1.8;font-size:30rpx;color:#0f172a;",
  span: "line-height:1.8;font-size:30rpx;color:#0f172a;",
  strong: "font-weight:700;color:#0f172a;",
  em: "font-style:italic;",
  ul: "margin:0 0 18rpx 1.5em;padding:0;line-height:1.8;font-size:30rpx;color:#0f172a;",
  ol: "margin:0 0 18rpx 1.5em;padding:0;line-height:1.8;font-size:30rpx;color:#0f172a;",
  li: "margin:0 0 12rpx;",
  blockquote:
    "margin:0 0 18rpx;padding:18rpx 22rpx;border-left:6rpx solid #bfdbfe;background:#eff6ff;color:#334155;border-radius:0 18rpx 18rpx 0;",
  pre: "margin:0 0 18rpx;padding:20rpx;border-radius:18rpx;background:#0f172a;color:#e2e8f0;white-space:pre-wrap;overflow:auto;",
  code: "font-family:Menlo,Monaco,Consolas,monospace;",
  table: "margin:0 0 18rpx;width:100%;font-size:26rpx;line-height:1.6;",
  th: "background:#eff6ff;color:#0f172a;",
  td: "color:#334155;",
};

const OPTION_MARKDOWN_TAG_STYLE = {
  p: "margin:0 0 14rpx;line-height:1.8;font-size:28rpx;color:#334155;",
  div: "line-height:1.8;font-size:28rpx;color:#334155;",
  span: "line-height:1.8;font-size:28rpx;color:#334155;",
  strong: "font-weight:700;color:#0f172a;",
  em: "font-style:italic;",
  ul: "margin:0 0 14rpx 1.5em;padding:0;line-height:1.8;font-size:28rpx;color:#334155;",
  ol: "margin:0 0 14rpx 1.5em;padding:0;line-height:1.8;font-size:28rpx;color:#334155;",
  li: "margin:0 0 10rpx;",
  blockquote:
    "margin:0 0 14rpx;padding:16rpx 20rpx;border-left:6rpx solid #bfdbfe;background:#eff6ff;color:#334155;border-radius:0 16rpx 16rpx 0;",
  pre: "margin:0 0 14rpx;padding:18rpx;border-radius:16rpx;background:#0f172a;color:#e2e8f0;white-space:pre-wrap;overflow:auto;",
  code: "font-family:Menlo,Monaco,Consolas,monospace;",
};

function normalizeMarkdownContent(value) {
  return typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
}

function attachRenderedRichContent(content) {
  const source = content || {};
  if (source.sourceType !== "text") {
    return {
      ...source,
      renderedContent: "",
      renderAsPlainText: false,
    };
  }
  return {
    ...source,
    renderedContent: normalizeMarkdownContent(source.text),
    renderAsPlainText: false,
  };
}

function attachRenderedOptionItem(option) {
  const source = option || {};
  if (source.sourceType !== "text") {
    return {
      ...source,
      renderedContent: "",
      renderAsPlainText: false,
    };
  }
  return {
    ...source,
    renderedContent: normalizeMarkdownContent(source.text),
    renderAsPlainText: false,
  };
}

module.exports = {
  OPTION_MARKDOWN_CONTAINER_STYLE,
  OPTION_MARKDOWN_TAG_STYLE,
  STEM_MARKDOWN_CONTAINER_STYLE,
  STEM_MARKDOWN_TAG_STYLE,
  attachRenderedOptionItem,
  attachRenderedRichContent,
};
