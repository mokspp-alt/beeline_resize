# beeline_resize

AI-инструмент для Figma: берёт один исходный макет и адаптирует его под все нужные размеры — брейкпоинты Web, экраны iOS/Android-приложения, дисплейные и социальные баннеры — на компонентах и токенах дизайн-системы **Carnica**.

Спецификация: [`openspec/changes/add-figma-ai-resize`](openspec/changes/add-figma-ai-resize) (proposal, specs, design, tasks).

## Структура

| Пакет | Что это |
|---|---|
| `packages/shared` | Схемы (описание макета, роли, план раскладки, конфиг ДС), каталог размеров |
| `packages/plugin` | Figma-плагин: захват исходника, UI, создание результирующих фреймов |
| `packages/backend` | AI-бэкенд (Fastify): роли элементов, планы раскладки, LLM-провайдеры |
| `config/` | Конфигурация дизайн-системы Carnica и командный каталог размеров |

## Требования

- Node.js 22+
- Figma Desktop (для запуска плагина в режиме разработки)

## Запуск локально

```bash
npm install
```

```bash
npm run build
```

```bash
npm test
```

### Бэкенд

```bash
cp .env.example .env
```

```bash
npm run dev:backend
```

Проверка: `curl http://localhost:8787/health` → `{"status":"ok"}`.

### Плагин

1. Соберите плагин: `npm run build` (или `npm run dev:plugin` для пересборки при изменениях).
2. В Figma Desktop: **Plugins → Development → Import plugin from manifest…** → выберите `packages/plugin/manifest.json`.
3. Откройте файл, в котором включены библиотеки Carnica (**Assets → Libraries**), и запустите **Plugins → Development → Beeline Resize**.
4. Во вкладке «Настройки» введите командный токен (`PLUGIN_TOKEN` бэкенда).
5. Выделите один фрейм-исходник, выберите размеры (группы, наборы, свои размеры) и нажмите «Адаптировать». Результаты появятся справа от исходника; отчёт — в окне плагина, клик по пункту выделяет слой.

Адрес бэкенда задаётся при сборке переменной `BACKEND_URL` (по умолчанию `http://localhost:8787`). Домен бэкенда должен быть указан в `packages/plugin/manifest.json` → `networkAccess.allowedDomains`.

### Конфигурация Carnica

`config/design-system.json` описывает шесть библиотек Carnica и правила адаптации (моды переменных, варианты, замены WEB↔APP, токены). Черновик собирается во вкладке плагина «Дизайн-система» → «Сканировать дизайн-систему» (нужен `FIGMA_TOKEN` на бэкенде): администратор проверяет его, подтверждает замены (`confirmed: true`) и коммитит файл. Бэкенд перечитывает конфиг без перезапуска.

### Ручная проверка

Чек-лист проверки в Figma Desktop: [docs/manual-check.md](docs/manual-check.md).

### Docker

```bash
docker build -f packages/backend/Dockerfile -t beeline-resize-backend .
```

```bash
docker run --rm -p 8787:8787 --env-file .env beeline-resize-backend
```
