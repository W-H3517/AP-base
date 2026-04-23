const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

const QUESTIONS_COLLECTION = "questions";
const QUESTION_TYPE_CHOICE = "choice";
const CONTENT_SOURCE_TEXT = "text";
const CONTENT_SOURCE_IMAGE = "image";
const ENTRY_MODE_SINGLE = "single";
const OPTION_MODE_PER_OPTION = "per_option";

function ok(data = null) {
  return {
    success: true,
    data,
    errMsg: "",
  };
}

function fail(errMsg) {
  return {
    success: false,
    data: null,
    errMsg: errMsg instanceof Error ? errMsg.message : String(errMsg),
  };
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeRuntimeDataVersion(value) {
  return String(value || "").trim().toLowerCase() === "develop" ? "develop" : "trial";
}

function getQuestionsCollectionName(event) {
  const suffix = normalizeRuntimeDataVersion(event?.runtimeDataVersion || event?.data?.runtimeDataVersion) === "develop"
    ? "_dev"
    : "_trial";
  return `${QUESTIONS_COLLECTION}${suffix}`;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function sortQuestions(questions) {
  return [...questions].sort((left, right) => {
    const leftTime = Number(left?.createTime || 0);
    const rightTime = Number(right?.createTime || 0);
    if (leftTime !== rightTime) {
      return rightTime - leftTime;
    }
    const leftOrder = Number(left?.groupOrder || 0);
    const rightOrder = Number(right?.groupOrder || 0);
    return leftOrder - rightOrder;
  });
}

async function getAllQuestions(collectionName) {
  const records = [];
  let offset = 0;
  const batchSize = 100;

  while (true) {
    const resp = await db.collection(collectionName).skip(offset).limit(batchSize).get();
    const batch = Array.isArray(resp?.data) ? resp.data : [];
    if (!batch.length) {
      break;
    }
    records.push(...batch);
    if (batch.length < batchSize) {
      break;
    }
    offset += batch.length;
  }

  return records;
}

function getSingleQuestionVersion(question) {
  return String(Number(question?.updateTime || 0));
}

function stripQuestionForShare(question) {
  if (!question) {
    return null;
  }

  return {
    _id: question._id,
    questionId: question.questionId,
    questionLabel: normalizeString(question.questionLabel),
    groupId: normalizeString(question.groupId),
    questionType: question.questionType || QUESTION_TYPE_CHOICE,
    entryMode: question.entryMode || ENTRY_MODE_SINGLE,
    sharedStem:
      question.sharedStem && Object.keys(question.sharedStem).length
        ? cloneJson(question.sharedStem)
        : {},
    stem:
      question.stem
        ? cloneJson(question.stem)
        : {
            sourceType: CONTENT_SOURCE_TEXT,
            text: "",
            imageFileIds: [],
          },
    optionMode: question.optionMode || OPTION_MODE_PER_OPTION,
    options:
      question.options
        ? cloneJson(question.options)
        : {
            keys: [],
            items: [],
            groupedAsset: {
              sourceType: CONTENT_SOURCE_IMAGE,
              imageFileId: "",
            },
          },
    groupOrder: Number(question.groupOrder || 1),
    version: getSingleQuestionVersion(question),
    createTime: question.createTime,
    updateTime: question.updateTime,
  };
}

function buildPracticeQuestionItem(question) {
  const sanitized = stripQuestionForShare(question);
  return sanitized
    ? {
        questionId: sanitized.questionId,
        questionLabel: normalizeString(sanitized.questionLabel),
        groupId: sanitized.groupId,
        entryMode: sanitized.entryMode,
        groupOrder: Number(sanitized.groupOrder || 1),
        questionType: sanitized.questionType || QUESTION_TYPE_CHOICE,
        sharedStem:
          sanitized.sharedStem && Object.keys(sanitized.sharedStem).length
            ? sanitized.sharedStem
            : {},
        stem: sanitized.stem,
        optionMode: sanitized.optionMode || OPTION_MODE_PER_OPTION,
        options: sanitized.options,
        version: sanitized.version,
        createTime: sanitized.createTime,
        updateTime: sanitized.updateTime,
      }
    : null;
}

function hasRichContentImages(content) {
  const imageFileIds = Array.isArray(content?.imageFileIds)
    ? content.imageFileIds.map((item) => normalizeString(item)).filter(Boolean)
    : [];
  return imageFileIds.length > 0;
}

function hasOptionImages(options) {
  if (!options || !Array.isArray(options.items)) {
    return false;
  }

  return options.items.some((item) => {
    if (!item) {
      return false;
    }
    if (normalizeString(item.sourceType) === CONTENT_SOURCE_IMAGE) {
      return true;
    }
    return Boolean(normalizeString(item.imageFileId));
  });
}

function isTextOnlyQuestion(question) {
  if (!question) {
    return false;
  }

  if (hasRichContentImages(question.sharedStem) || hasRichContentImages(question.stem)) {
    return false;
  }

  if ((question.optionMode || OPTION_MODE_PER_OPTION) !== OPTION_MODE_PER_OPTION) {
    return false;
  }

  return !hasOptionImages(question.options);
}

function pickShareQuestion(questions) {
  const candidates = sortQuestions(
    Array.isArray(questions) ? questions.filter((item) => isTextOnlyQuestion(item)) : []
  );
  if (!candidates.length) {
    return null;
  }
  const selected = candidates[Math.floor(Math.random() * candidates.length)];
  return buildPracticeQuestionItem(selected);
}

exports.main = async (event) => {
  try {
    const collectionName = getQuestionsCollectionName(event || {});
    const allQuestions = await getAllQuestions(collectionName);
    return ok({
      generatedAt: Date.now(),
      question: pickShareQuestion(allQuestions),
    });
  } catch (error) {
    return fail(error);
  }
};
