# Painel de Demandas - EQTL PI SUL

Painel para pedir, encaminhar e acompanhar demandas entre setores. Roda inteiro no navegador, hospedado no **GitHub Pages**. Os dados ficam **cifrados** (AES-256-GCM) numa branch separada (`dados`) deste repositório. Os avisos por e-mail saem por uma rotina do **GitHub Actions** + **Power Automate**.

Não há servidor, banco de dados ou serviço pago.

## Como funciona

```
Navegador (link com a chave)
   ├─ abre o token do GitHub guardado cifrado no config.json
   ├─ lê os arquivos da branch "dados" e decifra no próprio navegador
   └─ cada alteração = um commit na branch "dados" (arquivo cifrado)

GitHub Actions (a cada 20 min e quando uma demanda muda)
   ├─ decifra os dados com o segredo PAINEL_CHAVE
   ├─ decide quem avisar (regras abaixo)
   └─ abre uma issue no repositório privado painel-avisos
          ↓
Power Automate (gatilho "When a new issue is opened and assigned to me")
   └─ Parse JSON → Apply to each → Send an email (V2)
```

## Instalar, atualizar, trocar o token

Abra `instalar_painel.html` (duplo clique, no Chrome ou Edge). Ele tem três opções:

- **Instalação nova:** publica o site e cria os dados do zero (admin, usuários de teste e exemplos). No fim, mostra o link de acesso e os dois segredos para criar.
- **Atualizar só o site:** publica as telas novas e mantém dados, chave e token.
- **Trocar o token:** quando o token expirar. Pede a chave atual.

Segredos do repositório (**Settings › Secrets and variables › Actions**):

| Nome | Valor |
|---|---|
| `PAINEL_CHAVE` | a chave de acesso (a mesma do link) |
| `AVISOS_TOKEN` | o token do GitHub (precisa de Issues: leitura e escrita no `painel-avisos`) |

**No Power Automate**, logo depois do gatilho, coloque uma **Condition**: *Title* **starts with** `Painel-Avisos`. O resto do fluxo vai no lado **True**. Assim, issues de outros repositórios da mesma conta não viram e-mail.

## Perfis

| Perfil | Acesso |
|---|---|
| Colaborador (padrão) | Demandas que criou, que estão ou estiveram com ele, e as que acompanha. |
| Gestor e Gerente (mesmo nível) | Tudo do setor, redistribuição na equipe e indicadores. **Gerentes** recebem as cobranças de atraso. O **gerente principal** recebe o que chega ao setor sem pessoa definida. |
| Administrador | Tudo. Setores, pessoas, cadastro em massa, avisos e dados. |

**Cadastro em massa** (Administração › Pessoas): cole do Excel as colunas `nome, email, telefone, setor, perfil`.
- O login é a parte antes do @, e vale e-mail de empresa parceira.
- Perfil vazio = Colaborador.
- No fim, o painel gera a planilha com os acessos criados.

## Avisos

Todos os assuntos começam com **`[Painel Demandas]`**, para facilitar regras no Outlook.

| Quando | Quem | Como |
|---|---|---|
| Demanda nova ou encaminhada | Responsável | Na hora (urgente: também os gerentes do setor) |
| Devolvida ou reaberta | Responsável | Na hora |
| Concluída, precisa confirmar | Quem criou | Na hora |
| Alta não aberta em 4h / urgente em 2h | Responsável (urgente: + gerentes) | Lembrete |
| Venceu sem conclusão | Responsável e gerentes do setor | Primeiro dia de atraso |
| Resumo do dia (atrasadas, vencendo, para confirmar, novas, atrasadas da equipe) | Cada pessoa com pendência | 8h, dias úteis |
| Atrasada há mais de 5 dias | Administrador | No resumo |
| Mensagem no chat | Envolvidos | Só no painel (sem e-mail) |

Fora do horário (seg–sex, 8h–18h), só urgentes saem na hora; o resto entra no resumo.

**Modo teste** (ligado na instalação): todos os e-mails vão para o e-mail do administrador, com o destinatário original no assunto. Desligue em Administração › Avisos.

Para o WhatsApp, o botão **Baixar Excel (WhatsApp)** gera a planilha nome / numero / lista com o mesmo conteúdo do resumo.

## Limites e cuidados

- **Quem tem o link tem a chave**, e a chave abre o token com permissão de gravar no repositório. As permissões de perfil valem na tela; o histórico do git registra quem mudou o quê. Para cortar o acesso, troque o token (instalador) e, se precisar, faça uma instalação nova com outra chave.
- **Limites do GitHub para o token** (somando todas as pessoas):
  - cerca de 5.000 consultas por hora;
  - cerca de 500 gravações por hora.
  
  A atualização automática consulta a cada 30 s só com a aba visível, e a consulta "nada mudou" não gasta cota. Isso folga para algumas dezenas de pessoas com o painel aberto.
- **Imagens** são reduzidas no navegador (até 1600 px, cerca de 350 KB) e cifradas antes de subir. O GitHub recomenda repositórios abaixo de ~1 GB.
- **Backup:** cada alteração é um commit, então o histórico da branch `dados` é o backup. Em Administração › Dados dá para baixar uma cópia completa e o JSON para o painel de análise (`ferramentas/painel_analise.html`).
- **A rotina do Actions** pode atrasar alguns minutos nos horários de pico do GitHub. Em repositório público, ela para sozinha depois de 60 dias sem nenhuma atividade no repositório.

## Estrutura

```
index.html, css/, js/              telas (sem build)
js/core/crypto.js                  AES-256-GCM, PBKDF2, senhas
js/core/github.js, store.js        leitura/gravação dos arquivos cifrados
js/core/logic.js, routes.js        regras de negócio e "API" local
js/core/avisos.js                  regras e e-mail dos avisos (usado também pelo Actions)
.github/workflows/avisos.yml       rotina de avisos
.github/avisos/run.mjs             script da rotina
ferramentas/painel_analise.html    painel de análise (abre os JSON exportados)
apresentacao.html                  apresentação do projeto
```
