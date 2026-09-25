/**
 * `parseMediaUrl` virou um adaptador fino sobre `reconhecerLink` (a fonte
 * única em `@/lib/plataformas`). Este teste prova que, para uma amostra dos
 * formatos que o pipeline sempre aceitou, o comportamento é idêntico ao de
 * antes do refactor — mesma plataforma, mesmo ID, mesmos negativos.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseMediaUrl, parseYoutubeUrl } from "@/pipeline/lib/paths";

describe("parseMediaUrl — amostra por plataforma", () => {
  test("YouTube watch?v=", () => {
    assert.deepEqual(parseMediaUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), {
      platform: "youtube",
      id: "dQw4w9WgXcQ",
    });
  });

  test("YouTube youtu.be", () => {
    assert.deepEqual(parseMediaUrl("https://youtu.be/dQw4w9WgXcQ"), {
      platform: "youtube",
      id: "dQw4w9WgXcQ",
    });
  });

  test("YouTube shorts", () => {
    assert.deepEqual(parseMediaUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ"), {
      platform: "youtube",
      id: "dQw4w9WgXcQ",
    });
  });

  test("ID puro de 11 chars", () => {
    assert.deepEqual(parseMediaUrl("dQw4w9WgXcQ"), { platform: "youtube", id: "dQw4w9WgXcQ" });
  });

  test("Instagram reel", () => {
    assert.deepEqual(parseMediaUrl("https://www.instagram.com/reel/Cxyz123ABC/"), {
      platform: "instagram",
      id: "Cxyz123ABC",
    });
  });

  test("Instagram post (p)", () => {
    assert.deepEqual(parseMediaUrl("https://www.instagram.com/p/Cxyz123ABC/"), {
      platform: "instagram",
      id: "Cxyz123ABC",
    });
  });

  test("TikTok /@user/video/<id>", () => {
    assert.deepEqual(parseMediaUrl("https://www.tiktok.com/@someuser/video/7123456789012345678"), {
      platform: "tiktok",
      id: "7123456789012345678",
    });
  });

  test("TikTok link curto (id vazio)", () => {
    assert.deepEqual(parseMediaUrl("https://vm.tiktok.com/ZMabc123/"), {
      platform: "tiktok",
      id: "",
    });
  });

  test("host desconhecido → null", () => {
    assert.equal(parseMediaUrl("https://vimeo.com/123456"), null);
  });

  test("string vazia → null", () => {
    assert.equal(parseMediaUrl(""), null);
  });
});

describe("parseYoutubeUrl — compat (só o id)", () => {
  test("extrai o id de uma URL de YouTube", () => {
    assert.equal(parseYoutubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  });

  test("null quando o link não é suportado", () => {
    assert.equal(parseYoutubeUrl("https://vimeo.com/123456"), null);
  });
});
