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

Адрес бэкенда задаётся при сборке переменной `BACKEND_URL` (по умолчанию `http://localhost:8787`). Домен бэкенда должен быть указан в `packages/plugin/manifest.json` → `networkAccess.allowedDomains`.

### Docker

```bash
docker build -f packages/backend/Dockerfile -t beeline-resize-backend .
```

```bash
docker run --rm -p 8787:8787 --env-file .env beeline-resize-backend
```
