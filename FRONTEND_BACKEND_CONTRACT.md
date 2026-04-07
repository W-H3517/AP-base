# 前后端对接文档

本文档记录当前小程序前端与云函数后端已经对齐的动作名、请求结构、返回结构和关键字段约束。

适用范围：

- [miniprogram](D:/CP/AP-MiniProgram/miniprogram)
- [cloudfunctions/questionService](D:/CP/AP-MiniProgram/cloudfunctions/questionService)
- [cloudfunctions/userService](D:/CP/AP-MiniProgram/cloudfunctions/userService)

## 1. 通用调用规则

### 1.1 云函数划分

前端按动作调用两个云函数：

- `questionService`
  - 题目、题组、题库相关接口
- `userService`
  - 用户身份、集合初始化、二维码相关接口

### 1.2 通用返回格式

所有动作统一返回：

```json
{
  "success": true,
  "data": {},
  "errMsg": ""
}
```

失败时：

```json
{
  "success": false,
  "data": null,
  "errMsg": "错误信息"
}
```

### 1.3 权限规则

- 普通用户可以读取题目
- 管理员可以新增、编辑、删除题目和题组
- 管理员身份由后端根据 `OPENID` 和环境变量 `ADMIN_OPENIDS` 判断
- 普通用户读取题目时不会返回 `correctOptionKeys`

## 2. 用户与工具接口

由 `userService` 处理。

### 2.1 `getOpenId`

请求：

```json
{
  "type": "getOpenId"
}
```

返回 `data`：

```json
{
  "openid": "xxx",
  "appid": "xxx",
  "unionid": "xxx"
}
```

### 2.2 `getCurrentUser`

请求：

```json
{
  "type": "getCurrentUser"
}
```

返回 `data`：

```json
{
  "openid": "xxx",
  "role": "admin",
  "createTime": 0,
  "updateTime": 0
}
```

`role` 仅有两种可能：

- `admin`
- `user`

### 2.3 `initCollections`

请求：

```json
{
  "type": "initCollections"
}
```

返回 `data`：

```json
{
  "usersCreated": false,
  "questionsCreated": false,
  "notes": [
    "Ensure a unique index on users.openid in the cloud database console.",
    "Ensure a unique index on questions.questionId in the cloud database console."
  ]
}
```

说明：

- 当前实现会尝试创建 `users` 与 `questions` 集合
- `usersCreated/questionsCreated` 当前主要作为占位字段保留

### 2.4 `getMiniProgramCode`

请求：

```json
{
  "type": "getMiniProgramCode"
}
```

返回 `data`：

```json
"cloud://..."
```

## 3. 题目对象结构

所有题目接口都基于同一份题目对象。

```json
{
  "questionId": "q_xxx",
  "groupId": "",
  "questionType": "choice",
  "entryMode": "single",
  "sharedStem": {},
  "stem": {
    "sourceType": "text",
    "text": "题干文本",
    "imageFileIds": []
  },
  "optionMode": "per_option",
  "options": {
    "keys": ["A", "B"],
    "items": [
      {
        "key": "A",
        "sourceType": "text",
        "text": "选项A",
        "imageFileId": ""
      }
    ],
    "groupedAsset": {
      "sourceType": "image",
      "imageFileId": ""
    }
  },
  "correctOptionKeys": ["A"],
  "groupOrder": 1,
  "createTime": 0,
  "updateTime": 0,
  "createdBy": "",
  "updatedBy": ""
}
```

## 4. 字段约束

### 4.1 `questionType`

当前固定为：

```json
"choice"
```

### 4.2 `entryMode`

当前仅支持：

- `single`
- `grouped`

含义：

- `single`：单题录入
- `grouped`：关联题录入，表示该题属于某个题组

### 4.3 `groupId`

- `single` 模式下固定为空字符串 `""`
- `grouped` 模式下同组子题共享同一个 `groupId`

### 4.4 `groupOrder`

- `single` 模式下固定为 `1`
- `grouped` 模式下由前端子题顺序决定，从 `1` 开始

### 4.5 `stem` 与 `sharedStem`

两者结构一致：

```json
{
  "sourceType": "text | image",
  "text": "",
  "imageFileIds": []
}
```

规则：

- 当 `sourceType = "text"` 时
  - `text` 必填
  - `imageFileIds` 必须为空数组
- 当 `sourceType = "image"` 时
  - `imageFileIds` 必须是非空数组
  - `text` 必须为空字符串

补充说明：

- `sharedStem` 代表公共题干
- `single` 模式下 `sharedStem` 可以为空对象 `{}`
- `grouped` 模式下 `sharedStem` 必填，且整组子题冗余保存同一份内容

### 4.6 `optionMode`

当前仅支持：

- `per_option`
- `grouped_asset`

### 4.7 `options`

结构：

```json
{
  "keys": ["A", "B"],
  "items": [
    {
      "key": "A",
      "sourceType": "text | image",
      "text": "",
      "imageFileId": ""
    }
  ],
  "groupedAsset": {
    "sourceType": "image",
    "imageFileId": ""
  }
}
```

#### `per_option` 模式

规则：

- `options.keys` 必须是非空数组
- `options.items` 必须是非空数组
- `options.items[*].key` 与 `options.keys` 必须完全一致且顺序一致
- 每个选项只支持：
  - 文本
  - 单张图片
- `options.groupedAsset.imageFileId` 必须为空

#### `grouped_asset` 模式

规则：

- `options.keys` 必须是非空数组
- `options.items` 必须为空数组
- `options.groupedAsset.imageFileId` 必填
- `groupedAsset` 当前只支持单张大图，不支持多图

### 4.8 `correctOptionKeys`

规则：

- 必须为非空数组
- 值必须来自 `options.keys`
- 不允许重复
- 后端会统一转成大写

## 5. 单题接口

由 `questionService` 处理。

### 5.1 `listQuestions`

请求：

```json
{
  "type": "listQuestions"
}
```

返回 `data`：

```json
[
  {
    "questionId": "q_xxx",
    "groupId": "",
    "questionType": "choice",
    "entryMode": "single",
    "sharedStem": {},
    "stem": {
      "sourceType": "text",
      "text": "题干文本",
      "imageFileIds": []
    },
    "optionMode": "per_option",
    "options": {
      "keys": ["A", "B"],
      "items": [],
      "groupedAsset": {
        "sourceType": "image",
        "imageFileId": ""
      }
    },
    "groupOrder": 1,
    "createTime": 0,
    "updateTime": 0
  }
]
```

说明：

- 返回平铺列表
- 题组中的每个子题也会单独出现在列表中
- 普通用户不返回 `correctOptionKeys`
- 管理员会返回 `correctOptionKeys / createdBy / updatedBy`

### 5.2 `getQuestionDetail`

请求：

```json
{
  "type": "getQuestionDetail",
  "questionId": "q_xxx"
}
```

返回 `data`：

- 一条完整题目对象

### 5.3 `createQuestion`

请求：

```json
{
  "type": "createQuestion",
  "questionType": "choice",
  "entryMode": "single",
  "sharedStem": {},
  "stem": {
    "sourceType": "image",
    "text": "",
    "imageFileIds": ["cloud://a", "cloud://b"]
  },
  "optionMode": "per_option",
  "options": {
    "keys": ["A", "B"],
    "items": [
      {
        "key": "A",
        "sourceType": "text",
        "text": "选项A",
        "imageFileId": ""
      },
      {
        "key": "B",
        "sourceType": "image",
        "text": "",
        "imageFileId": "cloud://b"
      }
    ],
    "groupedAsset": {
      "sourceType": "image",
      "imageFileId": ""
    }
  },
  "correctOptionKeys": ["A"]
}
```

返回 `data`：

```json
{
  "questionId": "q_xxx"
}
```

### 5.4 `updateQuestion`

请求：

```json
{
  "type": "updateQuestion",
  "questionId": "q_xxx",
  "questionType": "choice",
  "entryMode": "single",
  "sharedStem": {},
  "stem": {
    "sourceType": "text",
    "text": "新的题干",
    "imageFileIds": []
  },
  "optionMode": "grouped_asset",
  "options": {
    "keys": ["A", "B", "C"],
    "items": [],
    "groupedAsset": {
      "sourceType": "image",
      "imageFileId": "cloud://big-image"
    }
  },
  "correctOptionKeys": ["B"]
}
```

返回 `data`：

```json
{
  "questionId": "q_xxx"
}
```

说明：

- 只允许更新 `entryMode = single` 的题目
- 如果传入的是关联题子题，后端会拒绝并提示使用题组更新接口

### 5.5 `deleteQuestion`

请求：

```json
{
  "type": "deleteQuestion",
  "questionId": "q_xxx"
}
```

返回 `data`：

```json
{
  "questionId": "q_xxx"
}
```

## 6. 题组接口

由 `questionService` 处理。

### 6.1 `getQuestionGroupDetail`

请求：

```json
{
  "type": "getQuestionGroupDetail",
  "groupId": "g_xxx"
}
```

返回 `data`：

```json
{
  "groupId": "g_xxx",
  "entryMode": "grouped",
  "sharedStem": {
    "sourceType": "image",
    "text": "",
    "imageFileIds": ["cloud://a", "cloud://b"]
  },
  "children": [
    {
      "questionId": "q_1",
      "groupId": "g_xxx",
      "groupOrder": 1,
      "entryMode": "grouped",
      "questionType": "choice",
      "sharedStem": {
        "sourceType": "image",
        "text": "",
        "imageFileIds": ["cloud://a", "cloud://b"]
      },
      "stem": {
        "sourceType": "text",
        "text": "子题1题干",
        "imageFileIds": []
      },
      "optionMode": "per_option",
      "options": {
        "keys": ["A", "B"],
        "items": [],
        "groupedAsset": {
          "sourceType": "image",
          "imageFileId": ""
        }
      }
    }
  ]
}
```

说明：

- `children` 按 `groupOrder` 升序返回

### 6.2 `createQuestionGroup`

请求：

```json
{
  "type": "createQuestionGroup",
  "sharedStem": {
    "sourceType": "text",
    "text": "公共题干",
    "imageFileIds": []
  },
  "children": [
    {
      "questionType": "choice",
      "stem": {
        "sourceType": "text",
        "text": "子题1",
        "imageFileIds": []
      },
      "optionMode": "per_option",
      "options": {
        "keys": ["A", "B"],
        "items": [
          {
            "key": "A",
            "sourceType": "text",
            "text": "A",
            "imageFileId": ""
          },
          {
            "key": "B",
            "sourceType": "text",
            "text": "B",
            "imageFileId": ""
          }
        ],
        "groupedAsset": {
          "sourceType": "image",
          "imageFileId": ""
        }
      },
      "correctOptionKeys": ["A"]
    }
  ]
}
```

返回 `data`：

```json
{
  "groupId": "g_xxx"
}
```

说明：

- 后端会自动生成 `groupId`
- 后端会自动为每个子题生成 `questionId`
- 后端按 `children` 顺序写入 `groupOrder`
- 每个子题会冗余保存同一份 `sharedStem`

### 6.3 `updateQuestionGroup`

请求：

```json
{
  "type": "updateQuestionGroup",
  "groupId": "g_xxx",
  "sharedStem": {
    "sourceType": "image",
    "text": "",
    "imageFileIds": ["cloud://a"]
  },
  "children": [
    {
      "questionId": "q_1",
      "questionType": "choice",
      "stem": {
        "sourceType": "text",
        "text": "更新后的子题1",
        "imageFileIds": []
      },
      "optionMode": "grouped_asset",
      "options": {
        "keys": ["A", "B", "C"],
        "items": [],
        "groupedAsset": {
          "sourceType": "image",
          "imageFileId": "cloud://big"
        }
      },
      "correctOptionKeys": ["C"]
    }
  ]
}
```

返回 `data`：

```json
{
  "groupId": "g_xxx"
}
```

说明：

- 当前采用整组全量更新语义
- 后端会先删除旧组内记录，再按提交的 `children` 重建整组
- 若某个子题带了旧的 `questionId`，后端会尽量保留该 `questionId`
- 新增子题若没有 `questionId`，后端会自动生成

## 7. 前端调用分流规则

当前前端调用规则如下：

- 首页只调用 `userService`
- 题库页面按动作自动分流：
  - 用户/工具动作发给 `userService`
  - 题目/题组动作发给 `questionService`

当前使用的动作分流名单：

### 发给 `userService`

- `getOpenId`
- `getCurrentUser`
- `initCollections`
- `getMiniProgramCode`

### 发给 `questionService`

- `listQuestions`
- `getQuestionDetail`
- `getQuestionGroupDetail`
- `createQuestion`
- `updateQuestion`
- `createQuestionGroup`
- `updateQuestionGroup`
- `deleteQuestion`

## 8. 后续改动原则

如果后续重构前端或继续演进后端，建议遵守：

- 不要随意修改动作名 `type`
- 不要随意修改统一返回结构 `{ success, data, errMsg }`
- 若要新增字段，尽量追加，不要破坏现有字段
- 若要变更题目对象结构，先更新本文件，再更新前后端实现
