/**
 * Testes da fonte única de plataformas (`src/lib/plataformas.ts`).
 *
 * Cobre `detectarPlataforma` (só o host, usado pela extensão) e
 * `reconhecerLink` (plataforma + ID, usado pelo parser do pipeline) — para
 * cada formato de link listado em `PLATAFORMAS`, e os negativos que provam
 * que o reconhecedor não aceita qualquer coisa do host certo.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { detectarPlataforma, reconhecerLink } from "@/lib/plataformas";

describe("detectarPlataforma — só o host", () => {
  test("YouTube: youtube.com, youtu.be, music.youtube.com", () => {
    assert.equal(detectarPlataforma("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "youtube");
    assert.equal(detectarPlataforma("https://youtu.be/dQw4w9WgXcQ"), "youtube");
    assert.equal(detectarPlataforma("https://music.youtube.com/watch?v=dQw4w9WgXcQ"), "youtube");
  });

  test("Instagram: domínio raiz e subdomínio", () => {
    assert.equal(detectarPlataforma("https://www.instagram.com/reel/abc123/"), "instagram");
    assert.equal(detectarPlataforma("https://m.instagram.com/reel/abc123/"), "instagram");
  });

  test("TikTok: domínio raiz e subdomínios vm./vt.", () => {
    assert.equal(detectarPlataforma("https://www.tiktok.com/@user/video/123"), "tiktok");
    assert.equal(detectarPlataforma("https://vm.tiktok.com/ZMabc123/"), "tiktok");
    assert.equal(detectarPlataforma("https://vt.tiktok.com/ZMabc123/"), "tiktok");
  });

  test("host desconhecido → null", () => {
    assert.equal(detectarPlataforma("https://vimeo.com/123456"), null);
  });

  test("string vazia / não-URL → null", () => {
    assert.equal(detectarPlataforma(""), null);
    assert.equal(detectarPlataforma("isto não é uma url"), null);
  });
});

describe("reconhecerLink — YouTube", () => {
  test("watch?v=", () => {
    assert.deepEqual(reconhecerLink("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), {
      plataforma: "youtube",
      id: "dQw4w9WgXcQ",
    });
  });

  test("youtu.be/<id>", () => {
    assert.deepEqual(reconhecerLink("https://youtu.be/dQw4w9WgXcQ"), {
      plataforma: "youtube",
      id: "dQw4w9WgXcQ",
    });
  });

  test("shorts/<id>", () => {
    assert.deepEqual(reconhecerLink("https://www.youtube.com/shorts/dQw4w9WgXcQ"), {
      plataforma: "youtube",
      id: "dQw4w9WgXcQ",
    });
  });

  test("embed/<id>", () => {
    assert.deepEqual(reconhecerLink("https://www.youtube.com/embed/dQw4w9WgXcQ"), {
      plataforma: "youtube",
      id: "dQw4w9WgXcQ",
    });
  });

  test("live/<id>", () => {
    assert.deepEqual(reconhecerLink("https://www.youtube.com/live/dQw4w9WgXcQ"), {
      plataforma: "youtube",
      id: "dQw4w9WgXcQ",
    });
  });

  test("music.youtube.com/watch?v=", () => {
    assert.deepEqual(reconhecerLink("https://music.youtube.com/watch?v=dQw4w9WgXcQ"), {
      plataforma: "youtube",
      id: "dQw4w9WgXcQ",
    });
  });

  test("ID puro de 11 chars (compatibilidade com o CLI)", () => {
    assert.deepEqual(reconhecerLink("dQw4w9WgXcQ"), { plataforma: "youtube", id: "dQw4w9WgXcQ" });
  });
});

describe("reconhecerLink — Instagram", () => {
  test("reel", () => {
    assert.deepEqual(reconhecerLink("https://www.instagram.com/reel/Cxyz123ABC/"), {
      plataforma: "instagram",
      id: "Cxyz123ABC",
    });
  });

  test("reels (plural)", () => {
    assert.deepEqual(reconhecerLink("https://www.instagram.com/reels/Cxyz123ABC/"), {
      plataforma: "instagram",
      id: "Cxyz123ABC",
    });
  });

  test("p (post)", () => {
    assert.deepEqual(reconhecerLink("https://www.instagram.com/p/Cxyz123ABC/"), {
      plataforma: "instagram",
      id: "Cxyz123ABC",
    });
  });

  test("tv (IGTV)", () => {
    assert.deepEqual(reconhecerLink("https://www.instagram.com/tv/Cxyz123ABC/"), {
      plataforma: "instagram",
      id: "Cxyz123ABC",
    });
  });

  test("subdomínio (m.instagram.com)", () => {
    assert.deepEqual(reconhecerLink("https://m.instagram.com/reel/Cxyz123ABC/"), {
      plataforma: "instagram",
      id: "Cxyz123ABC",
    });
  });

  test("home do Instagram sem caminho de vídeo → null", () => {
    assert.equal(reconhecerLink("https://www.instagram.com/"), null);
  });
});

describe("reconhecerLink — TikTok", () => {
  test("/@user/video/<id>", () => {
    assert.deepEqual(reconhecerLink("https://www.tiktok.com/@someuser/video/7123456789012345678"), {
      plataforma: "tiktok",
      id: "7123456789012345678",
    });
  });

  test("/video/<id> sem @user", () => {
    assert.deepEqual(reconhecerLink("https://www.tiktok.com/video/7123456789012345678"), {
      plataforma: "tiktok",
      id: "7123456789012345678",
    });
  });

  test("link curto vm.tiktok.com — id vazio (resolvido depois pelo yt-dlp)", () => {
    assert.deepEqual(reconhecerLink("https://vm.tiktok.com/ZMabc123/"), {
      plataforma: "tiktok",
      id: "",
    });
  });

  test("link curto vt.tiktok.com — id vazio", () => {
    assert.deepEqual(reconhecerLink("https://vt.tiktok.com/ZMabc123/"), {
      plataforma: "tiktok",
      id: "",
    });
  });

  test("perfil do TikTok sem /video/ → null (domínio raiz não é short link)", () => {
    assert.equal(reconhecerLink("https://www.tiktok.com/@someuser"), null);
  });
});

describe("reconhecerLink — negativos gerais", () => {
  test("host desconhecido → null", () => {
    assert.equal(reconhecerLink("https://vimeo.com/123456"), null);
  });

  test("string vazia → null", () => {
    assert.equal(reconhecerLink(""), null);
  });

  test("texto que não é URL → null", () => {
    assert.equal(reconhecerLink("isto não é uma url nem um id"), null);
  });
});

describe("achados da revisão cross-vendor de 25/09", () => {
  test("subdomínio do TikTok sem vídeo (shop., ads.) não vira link curto", () => {
    assert.equal(reconhecerLink("https://shop.tiktok.com/"), null);
    assert.equal(reconhecerLink("https://ads.tiktok.com/campanhas"), null);
    assert.equal(reconhecerLink("https://vm.tiktok.com/"), null);
  });
  test("home do Instagram e perfil do TikTok têm host certo e vídeo nenhum", () => {
    assert.equal(detectarPlataforma("https://www.instagram.com/"), "instagram");
    assert.equal(reconhecerLink("https://www.instagram.com/"), null);
    assert.equal(reconhecerLink("https://www.tiktok.com/@usuario"), null);
  });
  test("embed e live do YouTube são reconhecidos com o mesmo id", () => {
    assert.deepEqual(reconhecerLink("https://www.youtube.com/embed/dQw4w9WgXcQ"), { plataforma: "youtube", id: "dQw4w9WgXcQ" });
    assert.deepEqual(reconhecerLink("https://www.youtube.com/live/dQw4w9WgXcQ"), { plataforma: "youtube", id: "dQw4w9WgXcQ" });
  });
});
