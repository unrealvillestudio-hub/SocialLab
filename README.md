# SocialLab — Unreal>ille Studio

Generador de copy y scheduling para redes sociales del ecosistema Unreal>ille Studio.

**Deploy:** Pendiente (repo listo)
**Contexto completo del ecosistema:** [`CoreProject/CONTEXT.md`](https://github.com/unrealvillestudio-hub/CoreProject/blob/main/CONTEXT.md)

---

## Rol en el ecosistema

SocialLab produce copies nativos por plataforma (Instagram, TikTok, Facebook, LinkedIn) con estructura de calendario editorial. Se apoya en BP_PERSON para voz consistente y en CopyLab para copies de activación.

```
BluePrints (BP_PERSON voz) ──→ SocialLab (copy por plataforma + calendario)
CopyLab (copies base)                ↓
                           Scheduling / Publicación directa
```

---

## Stack

- React 18 + TypeScript + Vite + Tailwind
- AI: Gemini 2.0 Flash (Gemini API)
- Deploy: pendiente

---

## Estado

✅ v1.1 — repo listo, deploy pendiente

---

## Dependencias

| Consume | Provee |
|---------|--------|
| BP_PERSON (voz, tono por plataforma) | Calendarios editoriales |
| CopyLab (copies base) | Posts listos para publicar |

---

## Changelog

| Fecha | Cambio |
|---|---|
| 2026-03-20 | README actualizado con arquitectura de ecosistema |

---

## Desarrollo local

```bash
npm install
cp .env.example .env.local  # añade GEMINI_API_KEY
npm run dev
```
