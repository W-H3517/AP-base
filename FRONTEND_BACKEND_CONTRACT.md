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
- 管理员可以访问题目总列表、新增、删除题目和题组
- 管理员身份由后端根据 `OPENID` 和环境变量 `ADMIN_OPENIDS` 判断
- 普通用户读取题目时不会返回 `correctOptionKeys`

### 1.4 前端缓存规则

- 前端会对题目详情与题组详情进行本地缓存
- 详情缓存统一依赖详情返回中的 `version`
- 列表预览接口也会返回对应实体的 `version`
- 当前端发现本地缓存中的 `version` 与列表中的 `version` 一致时，可直接使用缓存
- 当前端发现 `version` 不一致时，需要重新请求详情并覆盖本地缓存

### 1.5 文件存储规则

- 前端上传图片时，统一先上传到云存储 `temp/` 目录
- 题目或题组保存成功后，后端会把本次提交中引用的临时文件复制到正式资源目录 `Resources/`
- 数据库中最终保存的 `imageFileId / imageFileIds` 必须始终指向正式资源，不保留 `temp/` 文件地址
- 单题正式资源目录为：
  - `Resources/single/<questionId>/...`
- 题组正式资源目录为：
  - `Resources/group/<groupId>/...`
- `temp/` 目录仅用于上传中转，允许后续手动清理

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
  "version": "1712563200000",
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

### 4.5.1 预览摘要字段

管理员总列表与题组展开预览使用摘要字段，不直接返回完整题干与完整选项内容。

单题预览结构：

```json
{
  "stemText": "题干摘要",
  "hasStemImage": false,
  "optionMode": "per_option",
  "optionKeys": ["A", "B", "C", "D"]
}
```

题组子题预览结构：

```json
{
  "questionId": "q_xxx",
  "groupId": "g_xxx",
  "groupOrder": 1,
  "questionType": "choice",
  "entryMode": "grouped",
  "preview": {
    "stemText": "子题题干摘要",
    "hasStemImage": false,
    "optionMode": "per_option",
    "optionKeys": ["A", "B"]
  },
  "version": "1712563200000",
  "createTime": 0,
  "updateTime": 0
}
```

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

### 4.9 `version`

规则：

- 所有详情接口都必须返回 `version`
- 所有列表预览接口也必须返回对应实体的 `version`
- `version` 用于前端缓存校验，建议由后端基于当前记录最新更新时间生成
- 对单题，`version` 应在题目内容发生变化时变化
- 对题组，组内任一子题或公共题干发生变化时，该题组及组内子题相关 `version` 都应同步变化

## 5. 管理员总列表接口

由 `questionService` 处理，仅管理员可调用。

### 5.1 `listQuestionSummaries`

请求：

```json
{
  "type": "listQuestionSummaries",
  "limit": 20,
  "cursor": "",
  "keyword": ""
}
```

请求规则：

- `limit` 可选，默认由后端决定，建议默认 `20`
- `cursor` 可选，用于分页续拉
- `keyword` 可选，用于后续支持按题干摘要等条件搜索
- 普通用户调用时应直接返回失败

返回 `data`：

```json
{
  "list": [
    {
      "entityType": "single",
      "questionId": "q_xxx",
      "groupId": "",
      "questionType": "choice",
      "entryMode": "single",
      "preview": {
        "stemText": "题干摘要",
        "hasStemImage": false,
        "optionMode": "per_option",
        "optionKeys": ["A", "B", "C", "D"]
      },
      "version": "1712563200000",
      "createTime": 0,
      "updateTime": 0
    },
    {
      "entityType": "group",
      "groupId": "g_xxx",
      "questionType": "choice",
      "entryMode": "grouped",
      "sharedStemPreview": {
        "stemText": "公共题干摘要",
        "hasStemImage": true
      },
      "childCount": 3,
      "childrenPreview": [
        {
          "questionId": "q_1",
          "groupId": "g_xxx",
          "groupOrder": 1,
          "questionType": "choice",
          "entryMode": "grouped",
          "preview": {
            "stemText": "子题1摘要",
            "hasStemImage": false,
            "optionMode": "per_option",
            "optionKeys": ["A", "B"]
          },
          "version": "1712563200000",
          "createTime": 0,
          "updateTime": 0
        }
      ],
      "version": "1712563200000",
      "createTime": 0,
      "updateTime": 0
    }
  ],
  "nextCursor": "opaque_cursor",
  "hasMore": true
}
```

返回规则：

- 管理员总列表按实体维度返回
- `entityType = single` 表示单题
- `entityType = group` 表示题组
- 题组在总列表中占一行，但前端点击展开后，使用 `childrenPreview` 平铺展示该组下的子题预览
- `childrenPreview` 只用于预览，不代表已经返回了子题完整详情
- 列表不得返回完整 `stem`、`sharedStem`、`options.items`、`correctOptionKeys`
- `nextCursor` 为空字符串时表示没有下一页

## 6. 单题接口

由 `questionService` 处理。

### 6.1 `getQuestionDetail`

请求：

```json
{
  "type": "getQuestionDetail",
  "questionId": "q_xxx"
}
```

返回 `data`：

- 一条完整题目对象
- 必须包含 `version`

### 6.2 `createQuestion`

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

说明：

- 如果本次提交中包含 `temp/` 下的图片文件，后端会在保存成功前复制到 `Resources/single/<questionId>/...`

### 6.3 `updateQuestion`

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

- 该接口动作名保留仅为兼容旧前端入口
- 后端当前固定返回失败：
  - `题目不支持直接编辑，请删除后重新创建`
- 单题内容如需变更，只允许：
  - 删除单题
  - 重新创建单题

### 6.4 `deleteQuestion`

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

说明：

- 仅允许删除单题
- 若 `questionId` 对应的是题组子题，后端应返回失败，提示删除整组
- 删除成功时，后端会同步删除该题目记录中关联的正式资源文件

## 7. 题组接口

由 `questionService` 处理。

### 7.1 `getQuestionGroupDetail`

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
  "version": "1712563200000",
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
- 必须包含题组级别 `version`
- `children[*]` 也必须包含各自 `version`

### 7.2 `createQuestionGroup`

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
- 如果本次提交中包含 `temp/` 下的图片文件，后端会在保存成功前复制到 `Resources/group/<groupId>/...`

### 7.3 `updateQuestionGroup`

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

- 该接口动作名保留仅为兼容旧前端入口
- 后端当前固定返回失败：
  - `题组不支持直接编辑，请删除整组后重新上传`
- 题组内容如需变更，只允许：
  - 删除整组
  - 重新创建题组

### 7.4 `deleteQuestionGroup`

请求：

```json
{
  "type": "deleteQuestionGroup",
  "groupId": "g_xxx"
}
```

返回 `data`：

```json
{
  "groupId": "g_xxx"
}
```

说明：

- 仅管理员可调用
- 删除语义为整组删除
- 后端应删除该 `groupId` 下所有子题记录
- 后端应同步删除该题组关联的全部正式资源文件
- 若 `groupId` 不存在，应返回失败
- 删除成功后，该题组对应的详情缓存应视为失效

## 8. 前端调用分流规则

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

- `listQuestionSummaries`
- `getQuestionDetail`
- `getQuestionGroupDetail`
- `createQuestion`
- `createQuestionGroup`
- `deleteQuestionGroup`
- `deleteQuestion`

## 9. 后续改动原则

如果后续重构前端或继续演进后端，建议遵守：

- 不要随意修改动作名 `type`
- 不要随意修改统一返回结构 `{ success, data, errMsg }`
- 若要新增字段，尽量追加，不要破坏现有字段
- 若要变更题目对象结构，先更新本文件，再更新前后端实现
- 管理员总列表与详情接口应长期保持“预览”和“完整内容”分层
- 若调整缓存规则，优先保持 `version` 机制兼容
- 若调整文件上传方式，优先保持“前端上传到 `temp/`、后端保存时转正式资源”这一分层
