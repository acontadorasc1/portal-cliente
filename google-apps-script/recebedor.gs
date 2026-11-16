/**
 * RECEBEDOR DO PORTAL DO CLIENTE — A CONTADORA (Versão 1, 16/11/2026)
 *
 * Roda na conta Google do escritório. Recebe o que o cliente envia pelo portal
 * e grava no Google Drive, numa pasta por processo, dentro de:
 *     Meu Drive > Portal do Cliente - Envios
 *
 * Cada pasta de processo fica assim:
 *     2026-11-16 09h30 - Nome da Empresa - Abertura/
 *         ficha.json                 (dados no formato do extrator)
 *         01 - RG ou CNH — Maria - foto.jpg
 *         02 - Comprovante de endereço — Maria - conta.pdf
 *         _COMPLETO.txt              (só aparece quando TODOS os documentos chegaram)
 *
 * Não tem senha nem chave aqui dentro: quem dá acesso ao Drive é a autorização
 * que você faz uma única vez na sua conta Google.
 */

const PASTA_RAIZ = "Portal do Cliente - Envios";
const AVISAR_POR_EMAIL = true; // manda um e-mail para você a cada envio completo

const ROTULOS = {
  abertura: "Abertura",
  alteracao: "Alteração",
  baixa: "Baixa",
  abertura_filial: "Abertura de filial",
  extincao_filial: "Extinção de filial",
};

function doGet() {
  return ContentService.createTextOutput("Recebedor do Portal do Cliente — A Contadora: funcionando.");
}

function doPost(e) {
  const trava = LockService.getScriptLock();
  try {
    const req = JSON.parse(e.postData.contents);
    let resposta;
    if (req.acao === "iniciar") {
      trava.waitLock(20000);
      resposta = iniciar_(req);
    } else if (req.acao === "arquivo") {
      resposta = arquivo_(req);
    } else if (req.acao === "concluir") {
      resposta = concluir_(req);
    } else {
      throw new Error("pedido inválido");
    }
    return json_(Object.assign({ ok: true }, resposta));
  } catch (err) {
    return json_({ ok: false, erro: String((err && err.message) || err) });
  } finally {
    try { trava.releaseLock(); } catch (x) {}
  }
}

function iniciar_(req) {
  const ficha = req.ficha;
  if (!ficha || ficha.formato !== "ficha-portal-cliente" || !ficha.data) throw new Error("ficha inválida");
  const emp = ficha.data.empresa || {};
  const quem = emp.razao_social || (ficha.contato && ficha.contato.nome) || "Cliente";
  const quando = Utilities.formatDate(new Date(), "America/Sao_Paulo", "yyyy-MM-dd HH'h'mm");
  const nome = [quando, limpa_(quem), ROTULOS[ficha.tipo] || ficha.tipo].join(" - ");

  const pasta = raiz_().createFolder(nome);
  pasta.createFile("ficha.json", JSON.stringify(ficha, null, 2), "application/json");
  pasta.createFile("_AGUARDANDO DOCUMENTOS.txt", "O cliente ainda está enviando os documentos deste processo.");

  const token = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty("tk_" + pasta.getId(), token);
  return { pasta: pasta.getId(), token: token };
}

function arquivo_(req) {
  const pasta = confere_(req);
  if (!req.base64) throw new Error("arquivo vazio");
  const blob = Utilities.newBlob(Utilities.base64Decode(req.base64), req.tipo || "application/octet-stream", limpa_(req.nome || "documento"));
  pasta.createFile(blob);
  return {};
}

function concluir_(req) {
  const pasta = confere_(req);
  const aguardando = pasta.getFilesByName("_AGUARDANDO DOCUMENTOS.txt");
  while (aguardando.hasNext()) aguardando.next().setTrashed(true);
  pasta.createFile("_COMPLETO.txt", "Envio completo em " + Utilities.formatDate(new Date(), "America/Sao_Paulo", "dd/MM/yyyy HH:mm") + ". Documentos: " + (req.total || 0) + ".");
  PropertiesService.getScriptProperties().deleteProperty("tk_" + req.pasta);

  if (AVISAR_POR_EMAIL) {
    try {
      const ficha = JSON.parse(pasta.getFilesByName("ficha.json").next().getBlob().getDataAsString());
      const c = ficha.contato || {};
      MailApp.sendEmail({
        to: Session.getEffectiveUser().getEmail(),
        subject: "Portal: novo envio — " + pasta.getName(),
        body:
          "Chegou um novo envio pelo Portal do Cliente.\n\n" +
          "Processo: " + (ROTULOS[ficha.tipo] || ficha.tipo) + "\n" +
          "Empresa: " + ((ficha.data.empresa || {}).razao_social || "-") + "\n" +
          "Quem enviou: " + [c.nome, c.telefone, c.email].filter(String).join(" · ") + "\n" +
          "Documentos: " + (req.total || 0) + "\n\n" +
          "Pasta no Drive: " + pasta.getUrl(),
      });
    } catch (x) {}
  }
  return {};
}

function confere_(req) {
  const certo = req.pasta && PropertiesService.getScriptProperties().getProperty("tk_" + req.pasta);
  if (!certo || certo !== req.token) throw new Error("envio não autorizado ou já concluído");
  return DriveApp.getFolderById(req.pasta);
}

function raiz_() {
  const it = DriveApp.getRootFolder().getFoldersByName(PASTA_RAIZ);
  return it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder(PASTA_RAIZ);
}

function limpa_(t) {
  return String(t).replace(/[\\/:*?"<>|#%]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 150) || "sem nome";
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** Rode esta função UMA vez pelo editor (botão "Executar") para fazer a autorização. */
function autorizar() {
  raiz_();
  MailApp.getRemainingDailyQuota();
  Logger.log("Tudo certo! A pasta \"" + PASTA_RAIZ + "\" está no seu Drive.");
}
