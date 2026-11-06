# Estudo Técnico de Implementação: Host de Native Messaging (ADR 0003)

**Data:** 17 de Outubro de 2026  
**Autor:** Time de Arquitetura e Engenharia IdeiaOS / Deia  
**Referência:** `docs/decisions/0003-ligar-pela-extensao.md` (ADR 0003)

---

## 1. Objetivo da Funcionalidade

Permitir que a extensão de navegador (Chrome MV3) **acorde o app local do Bruto sob demanda** através de um clique ("Destrinchar no app local"), especialmente para mídias do Instagram e TikTok que dependem do pipeline local de download e transcrição via Whisper.

### Princípios de Design (ADR 0003):
1. **Zero Daemons Ociosos:** Não rodar Node.js no boot do sistema (sem LaunchAgents no macOS ou Serviços no Windows desnecessários).
2. **Permissão Opcional:** A permissão `nativeMessaging` é opcional — quem usa apenas YouTube nunca vê avisos de permissões extras.
3. **Sobrevivência do Processo (`setsid`):** O servidor iniciado pelo host deve ser desacoplado do grupo de processos do navegador (`process group`), para não morrer quando o Chrome fechar a conexão do host nativo.

---

## 2. Arquitetura do Chrome Native Messaging

### 2.1 Protocolo de Comunicação (Framed I/O)
O Chrome comunica-se com o executável do host nativo através de `stdin` e `stdout` padronizados:
- Cada mensagem é precedida por **4 bytes** (inteiro de 32 bits sem sinal em Little-Endian) indicando o tamanho do payload JSON em bytes.
- O payload é um JSON serializado em UTF-8.
- O host deve ler `stdin`, processar a mensagem, emitir resposta de confirmação no mesmo formato em `stdout` e encerrar graciosamente.

### 2.2 Formato da Mensagem Extensão <-> Host
- **Mensagem enviada pela extensão:**
  ```json
  { "action": "start_server" }
  ```
- **Resposta enviada pelo host:**
  ```json
  { "status": "ok", "started": true, "url": "http://127.0.0.1:3000" }
  ```

---

## 3. Especificação dos Componentes

### 3.1 O Script Executável do Host (`launcher/native-host.mjs`)
Um script leve e autossuficiente em Node.js:

```javascript
#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serveScript = path.resolve(__dirname, "serve.mjs");

function readMessage() {
  const header = fs.readSync(0, 4);
  if (header.length < 4) return null;
  const len = header.readUInt32LE(0);
  const buf = fs.readSync(0, len);
  return JSON.parse(buf.toString("utf-8"));
}

function sendMessage(msg) {
  const json = Buffer.from(JSON.stringify(msg), "utf-8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(json.length, 0);
  process.stdout.write(header);
  process.stdout.write(json);
}

async function main() {
  const msg = readMessage();
  if (msg?.action === "start_server") {
    // Inicia em sessão totalmente desvinculada (detached + setsid)
    const child = spawn(process.execPath, [serveScript], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    sendMessage({ status: "ok", started: true, pid: child.pid });
  } else {
    sendMessage({ status: "ignored" });
  }
}

main().catch((err) => {
  sendMessage({ status: "error", error: err.message });
});
```

### 3.2 O Manifesto do Host (`com.ideiabusiness.bruto.json`)

```json
{
  "name": "com.ideiabusiness.bruto",
  "description": "Bruto Native Messaging Host",
  "path": "/Users/gustavolopespaiva/Bruto/launcher/native-host.sh",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://<ID_DA_EXTENSAO>/"
  ]
}
```

### 3.3 Diretórios de Registro no Sistema Operacional
O instalador do Bruto registrará o manifesto nos locais padrão:
- **macOS:** `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.ideiabusiness.bruto.json`
- **Linux:** `~/.config/google-chrome/NativeMessagingHosts/com.ideiabusiness.bruto.json`
- **Windows:** Registro em `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.ideiabusiness.bruto`

### 3.4 Acionamento na Extensão
Quando a extensão verificar que `http://127.0.0.1:3000/api/llm/saude` não responde:
```typescript
async function ligarAppLocal(): Promise<boolean> {
  try {
    const granted = await chrome.permissions.request({ permissions: ["nativeMessaging"] });
    if (!granted) return false;

    const response = await chrome.runtime.sendNativeMessage(
      "com.ideiabusiness.bruto",
      { action: "start_server" }
    );
    return response?.status === "ok";
  } catch (err) {
    console.error("Falha ao acionar host nativo:", err);
    return false;
  }
}
```
