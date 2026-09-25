import { Check, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { PLATAFORMAS, NAO_SUPORTADO } from "@/lib/plataformas";

/**
 * "O que o Bruto destrincha" — lista as plataformas suportadas a partir da
 * fonte única (`@/lib/plataformas`), para a tela não prometer o que o
 * parser não aceita (e vice-versa).
 *
 * `compacta`: só os badges de plataforma + tipos numa linha, para caber
 * abaixo do input do diálogo. Sem `compacta`: a seção completa, com card
 * sóbrio por plataforma (mesmo padrão visual de `hero-banner.tsx`).
 */
export function Compatibilidade({ compacta = false }: { compacta?: boolean }) {
  if (compacta) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {PLATAFORMAS.map((p) => (
          <span key={p.id} className="flex items-center gap-1">
            <Badge variant="secondary">{p.label}</Badge>
            <span className="text-[0.7rem]">{p.tiposDeVideo.join(", ")}</span>
          </span>
        ))}
      </div>
    );
  }

  return (
    <section className="space-y-3">
      <h2 className="px-1 text-lg font-bold tracking-tight">O que o Bruto destrincha</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {PLATAFORMAS.map((p) => (
          <Card key={p.id} className="border border-border shadow-xs">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Badge>{p.label}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {p.tiposDeVideo.map((tipo) => (
                  <Badge key={tipo} variant="outline" className="font-normal">
                    {tipo}
                  </Badge>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">{p.nota}</p>
              <div className="space-y-1 text-xs text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  {p.noAppLocal ? (
                    <Check className="size-3.5 text-foreground" />
                  ) : (
                    <Minus className="size-3.5" />
                  )}
                  App local
                </div>
                <div className="flex items-center gap-1.5">
                  {p.naExtensao ? (
                    <Check className="size-3.5 text-foreground" />
                  ) : (
                    <Minus className="size-3.5" />
                  )}
                  {p.naExtensao
                    ? "Extensão do navegador"
                    : p.noAppLocal
                      ? "Extensão do navegador (encaminha ao app local)"
                      : "Extensão do navegador"}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="px-1 text-xs text-muted-foreground">
        Não entra: {NAO_SUPORTADO.join(" · ")}.
      </p>
    </section>
  );
}
