function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueArray(values) {
  return Array.from(new Set(normalizeArray(values).filter(Boolean)));
}

function createImageAssetState(fileId, assetState) {
  const normalizedFileId = normalizeString(fileId);
  const source = assetState || {};
  return {
    fileId: normalizedFileId,
    src: normalizeString(source.src),
    status: normalizeString(source.status) || "idle",
    loaded: !!normalizeString(source.src),
  };
}

function decorateRichContentAssets(content, resolveAssetState) {
  const source = content && typeof content === "object" ? content : {};
  const imageFileIds = normalizeArray(source.imageFileIds)
    .map((item) => normalizeString(item))
    .filter(Boolean);
  return {
    ...source,
    imageAssets: imageFileIds.map((fileId) => createImageAssetState(fileId, resolveAssetState(fileId))),
  };
}

function decorateOptionsAssets(options, resolveAssetState) {
  const source = options && typeof options === "object" ? options : {};
  return {
    ...source,
    items: normalizeArray(source.items).map((item) => {
      const nextItem = item && typeof item === "object" ? { ...item } : {};
      if (normalizeString(nextItem.imageFileId)) {
        nextItem.imageAsset = createImageAssetState(
          nextItem.imageFileId,
          resolveAssetState(nextItem.imageFileId)
        );
      } else {
        nextItem.imageAsset = createImageAssetState("", null);
      }
      return nextItem;
    }),
    groupedAsset: {
      ...(source.groupedAsset && typeof source.groupedAsset === "object" ? source.groupedAsset : {}),
      imageAsset: createImageAssetState(
        source.groupedAsset && source.groupedAsset.imageFileId,
        resolveAssetState(source.groupedAsset && source.groupedAsset.imageFileId)
      ),
    },
  };
}

function decorateQuestionAssets(question, resolveAssetState) {
  const source = question && typeof question === "object" ? question : {};
  return {
    ...source,
    sharedStem: decorateRichContentAssets(source.sharedStem, resolveAssetState),
    stem: decorateRichContentAssets(source.stem, resolveAssetState),
    options: decorateOptionsAssets(source.options, resolveAssetState),
    children: normalizeArray(source.children).map((child) =>
      decorateQuestionAssets(child, resolveAssetState)
    ),
  };
}

function collectQuestionImageFileIds(question) {
  const source = question && typeof question === "object" ? question : {};
  const urls = [];

  normalizeArray(source.sharedStem && source.sharedStem.imageFileIds).forEach((item) => {
    const fileId = normalizeString(item);
    if (fileId) {
      urls.push(fileId);
    }
  });

  normalizeArray(source.stem && source.stem.imageFileIds).forEach((item) => {
    const fileId = normalizeString(item);
    if (fileId) {
      urls.push(fileId);
    }
  });

  normalizeArray(source.options && source.options.items).forEach((option) => {
    const fileId = normalizeString(option && option.imageFileId);
    if (fileId) {
      urls.push(fileId);
    }
  });

  const groupedAssetFileId = normalizeString(
    source.options && source.options.groupedAsset && source.options.groupedAsset.imageFileId
  );
  if (groupedAssetFileId) {
    urls.push(groupedAssetFileId);
  }

  normalizeArray(source.children).forEach((child) => {
    collectQuestionImageFileIds(child).forEach((fileId) => urls.push(fileId));
  });

  return uniqueArray(urls);
}

function hasQuestionImages(question) {
  return collectQuestionImageFileIds(question).length > 0;
}

function createPagedResourceManager(options = {}) {
  const onAssetUpdate =
    typeof options.onAssetUpdate === "function" ? options.onAssetUpdate : function () {};
  const maxConcurrency = Math.max(1, Number(options.concurrency) || 2);
  const assetCacheMap = new Map();
  const queuedFileIds = [];
  let activeCount = 0;
  let generation = 0;

  function touchEntry(entry) {
    if (entry) {
      entry.lastAccessAt = Date.now();
    }
  }

  function getAssetEntry(fileId) {
    const normalizedFileId = normalizeString(fileId);
    return normalizedFileId ? assetCacheMap.get(normalizedFileId) || null : null;
  }

  function getAssetState(fileId) {
    const normalizedFileId = normalizeString(fileId);
    if (!normalizedFileId) {
      return {
        fileId: "",
        src: "",
        status: "idle",
      };
    }
    const entry = getAssetEntry(normalizedFileId);
    if (!entry) {
      return {
        fileId: normalizedFileId,
        src: "",
        status: "idle",
      };
    }
    touchEntry(entry);
    return {
      fileId: normalizedFileId,
      src: normalizeString(entry.src),
      status: normalizeString(entry.status) || "idle",
    };
  }

  function processQueue() {
    while (activeCount < maxConcurrency && queuedFileIds.length) {
      const nextFileId = queuedFileIds.shift();
      const entry = getAssetEntry(nextFileId);
      if (!entry || entry.status !== "queued") {
        continue;
      }

      activeCount += 1;
      entry.status = "loading";
      touchEntry(entry);

      wx.cloud.downloadFile({
        fileID: nextFileId,
      }).then((result) => {
        if (entry.generation !== generation) {
          return;
        }
        entry.status = "ready";
        entry.src =
          normalizeString(result && result.tempFilePath) ||
          normalizeString(result && result.filePath) ||
          "";
        touchEntry(entry);
        onAssetUpdate(nextFileId, getAssetState(nextFileId));
        return entry;
      }).catch((error) => {
        if (entry.generation !== generation) {
          return null;
        }
        entry.status = "error";
        entry.error = error || null;
        entry.src = "";
        touchEntry(entry);
        onAssetUpdate(nextFileId, getAssetState(nextFileId));
        return null;
      }).finally(() => {
        if (entry.promiseHandlers) {
          if (entry.status === "ready") {
            entry.promiseHandlers.resolve(entry);
          } else if (entry.status === "error") {
            entry.promiseHandlers.reject(entry.error || new Error("图片下载失败"));
          }
        }
        entry.promiseHandlers = null;
        entry.promise =
          entry.status === "ready"
            ? Promise.resolve(entry)
            : entry.status === "error"
              ? Promise.reject(entry.error || new Error("图片下载失败")).catch(() => null)
              : null;
        activeCount = Math.max(0, activeCount - 1);
        processQueue();
      });
    }
  }

  function ensureAsset(fileId) {
    const normalizedFileId = normalizeString(fileId);
    if (!normalizedFileId) {
      return Promise.resolve(null);
    }

    let entry = getAssetEntry(normalizedFileId);
    if (entry) {
      touchEntry(entry);
      if (entry.status === "ready") {
        return Promise.resolve(entry);
      }
      if (entry.status === "loading" || entry.status === "queued") {
        return entry.promise || Promise.resolve(entry);
      }
    }

    entry = {
      fileId: normalizedFileId,
      src: "",
      status: "queued",
      generation,
      error: null,
      promise: null,
      promiseHandlers: null,
      lastAccessAt: Date.now(),
    };

    entry.promise = new Promise((resolve, reject) => {
      entry.promiseHandlers = {
        resolve,
        reject,
      };
    });

    assetCacheMap.set(normalizedFileId, entry);
    queuedFileIds.push(normalizedFileId);
    processQueue();
    return entry.promise;
  }

  return {
    reset() {
      generation += 1;
      assetCacheMap.clear();
      queuedFileIds.length = 0;
    },

    primePageItems(items) {
      return normalizeArray(items);
    },

    prefetchImagesForItems(currentItem, nextItem) {
      uniqueArray(
        collectQuestionImageFileIds(currentItem).concat(collectQuestionImageFileIds(nextItem))
      ).forEach((fileId) => {
        ensureAsset(fileId).catch(() => null);
      });
    },

    resolveQuestionAssets(question) {
      return decorateQuestionAssets(question, getAssetState);
    },

    resolvePreviewUrls(question) {
      return uniqueArray(
        collectQuestionImageFileIds(question).map((fileId) => getAssetState(fileId).src || fileId)
      );
    },

    getAssetState,
  };
}

module.exports = {
  collectQuestionImageFileIds,
  hasQuestionImages,
  createPagedResourceManager,
};
