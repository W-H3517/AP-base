/*!
 * mp-html v2.5.2
 * https://github.com/jin-yufeng/mp-html
 *
 * Released under the MIT license
 * Author: Jin Yufeng
 */
const Parser = require("./parser");
const Markdown = require("./plugins/markdown/index");
const Latex = require("./plugins/latex/index");

const plugins = [Markdown, Latex];

Component({
  data: {
    nodes: [],
  },
  properties: {
    markdown: Boolean,
    containerStyle: String,
    content: {
      type: String,
      value: "",
      observer(content) {
        this.setContent(content);
      },
    },
    copyLink: {
      type: Boolean,
      value: true,
    },
    domain: String,
    errorImg: String,
    lazyLoad: Boolean,
    loadingImg: String,
    pauseVideo: {
      type: Boolean,
      value: true,
    },
    previewImg: {
      type: null,
      value: true,
    },
    scrollTable: Boolean,
    selectable: null,
    setTitle: {
      type: Boolean,
      value: true,
    },
    showImgMenu: {
      type: Boolean,
      value: true,
    },
    tagStyle: Object,
    useAnchor: null,
  },
  created() {
    this.plugins = [];
    for (let i = plugins.length; i--;) {
      this.plugins.push(new plugins[i](this));
    }
  },
  detached() {
    this._hook("onDetached");
  },
  methods: {
    in(page, selector, scrollTop) {
      if (page && selector && scrollTop) {
        this._in = {
          page,
          selector,
          scrollTop,
        };
      }
    },
    navigateTo(id, offset) {
      id = this._ids[decodeURI(id)] || id;
      return new Promise((resolve, reject) => {
        if (!this.properties.useAnchor) {
          reject(Error("Anchor is disabled"));
          return;
        }

        const selector = wx
          .createSelectorQuery()
          .in(this._in ? this._in.page : this)
          .select((this._in ? this._in.selector : "._root") + (id ? `>>>#${id}` : ""))
          .boundingClientRect();

        if (this._in) {
          selector
            .select(this._in.selector)
            .scrollOffset()
            .select(this._in.selector)
            .boundingClientRect();
        } else {
          selector.selectViewport().scrollOffset();
        }

        selector.exec((res) => {
          if (!res[0]) {
            reject(Error("Label not found"));
            return;
          }
          const scrollTop =
            res[1].scrollTop +
            res[0].top -
            (res[2] ? res[2].top : 0) +
            (offset || parseInt(this.properties.useAnchor, 10) || 0);
          if (this._in) {
            this._in.page.setData({
              [this._in.scrollTop]: scrollTop,
            });
          } else {
            wx.pageScrollTo({
              scrollTop,
              duration: 300,
            });
          }
          resolve();
        });
      });
    },
    getText(nodes) {
      let text = "";
      (function traversal(list) {
        for (let i = 0; i < list.length; i += 1) {
          const node = list[i];
          if (node.type === "text") {
            text += node.text.replace(/&amp;/g, "&");
          } else if (node.name === "br") {
            text += "\n";
          } else {
            const isBlock =
              node.name === "p" ||
              node.name === "div" ||
              node.name === "tr" ||
              node.name === "li" ||
              (node.name[0] === "h" && node.name[1] > "0" && node.name[1] < "7");
            if (isBlock && text && text[text.length - 1] !== "\n") {
              text += "\n";
            }
            if (node.children) {
              traversal(node.children);
            }
            if (isBlock && text[text.length - 1] !== "\n") {
              text += "\n";
            } else if (node.name === "td" || node.name === "th") {
              text += "\t";
            }
          }
        }
      })(nodes || this.data.nodes);
      return text;
    },
    getRect() {
      return new Promise((resolve, reject) => {
        wx.createSelectorQuery()
          .in(this)
          .select("._root")
          .boundingClientRect()
          .exec((res) => (res[0] ? resolve(res[0]) : reject(Error("Root label not found"))));
      });
    },
    pauseMedia() {
      for (let i = (this._videos || []).length; i--;) {
        this._videos[i].pause();
      }
    },
    setPlaybackRate(rate) {
      this.playbackRate = rate;
      for (let i = (this._videos || []).length; i--;) {
        this._videos[i].playbackRate(rate);
      }
    },
    setContent(content, append) {
      if (!this.imgList || !append) {
        this.imgList = [];
      }
      this._videos = [];

      const data = {};
      const nodes = new Parser(this).parse(content);
      if (append) {
        for (let i = this.data.nodes.length, j = nodes.length; j--;) {
          data[`nodes[${i + j}]`] = nodes[j];
        }
      } else {
        data.nodes = nodes;
      }

      this.setData(data, () => {
        this._hook("onLoad");
        this.triggerEvent("load");
      });

      if (this.properties.lazyLoad || this.imgList._unloadimgs < this.imgList.length / 2) {
        let height = 0;
        const callback = (rect) => {
          const safeRect = rect && rect.height ? rect : {};
          if (safeRect.height === height) {
            this.triggerEvent("ready", safeRect);
          } else {
            height = safeRect.height;
            setTimeout(() => {
              this.getRect().then(callback).catch(callback);
            }, 350);
          }
        };
        this.getRect().then(callback).catch(callback);
      } else if (!this.imgList._unloadimgs) {
        this.getRect()
          .then((rect) => {
            this.triggerEvent("ready", rect);
          })
          .catch(() => {
            this.triggerEvent("ready", {});
          });
      }
    },
    _hook(name) {
      for (let i = plugins.length; i--;) {
        if (this.plugins[i][name]) {
          this.plugins[i][name]();
        }
      }
    },
    _add(e) {
      e.detail.root = this;
    },
  },
});
