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

- **Instalação nova (reinstalar do zero):** publica o site e cria os dados só com o administrador e os 9 setores. Se já houver instalação, **apaga demandas, pessoas e conversas** (ficam no histórico da branch `dados`).
- **Atualizar só o site:** publica as telas novas e mantém dados, palavra-chave e token.
- **Trocar o token:** quando o token mudar. Pede a palavra-chave atual. Depois, atualize também o segredo `AVISOS_TOKEN`.

No fim, o instalador confere se a rotina de avisos está publicada, se os segredos existem e permite **rodar a rotina na hora** para ver se funcionou.

Link de acesso: `https://<usuario>.github.io/Painel-de-Demandas/?k=demandas`. Quem abre sem o link vê a tela que pede a palavra-chave (o navegador lembra depois).

Segredos do repositório (**Settings › Secrets and variables › Actions**):

| Nome | Valor |
|---|---|
| `PAINEL_CHAVE` | a palavra-chave (a mesma do link) |
| `AVISOS_TOKEN` | o token do GitHub (Issues: leitura e escrita no `painel-avisos`) |

### Power Automate (e-mail + Teams)

1. Gatilho do GitHub **When a new issue is opened and assigned to me** → **Condition**: *Title* **starts with** `Painel-Avisos` (o resto no **True**).
2. **Parse JSON** do *Body* da issue com o esquema que o instalador mostra (cada notificação tem `para`, `assunto`, `mensagem_html`, `mensagem_teams` e `canais`).
3. **Apply to each** em `notificacoes`, com duas condições em paralelo:
   - `canais` **contains** `email` → **Send an email (V2)**: To `para`, Subject `assunto`, Body `mensagem_html`.
   - `canais` **contains** `teams` → Microsoft Teams › **Post message in a chat or channel**: Post as **Flow bot**, Post in **Chat with Flow bot**, Recipient `para`, Message `mensagem_teams`.

## Perfis

| Perfil | Acesso |
|---|---|
| Colaborador (padrão) | Demandas que criou, que estão ou estiveram com ele, e as que acompanha. |
| Executivo/Líder | Delegado do gerente: tudo do setor, redistribuição, Gestão (Demandas do setor, Indicadores, Equipe). |
| Gerente (um por setor) | O mesmo do executivo/líder, e mais: recebe o que chega ao setor sem pessoa definida e as cobranças de atraso. Nomear outro gerente passa o anterior a executivo/líder. |
| Administrador | Tudo. Setores, pessoas, cadastro em massa, origens, avisos e dados. |

**Cadastro em massa** (Administração › Pessoas): cole do Excel `nome, email, telefone, setor, perfil` (perfil: vazio/Colaborador, Executivo/Líder ou Gerente).

## Demandas

- **Origem do pedido:** lista suspensa mantida em Administração › Origens; também aceita texto livre.
- **Prazo da etapa (opcional):** definido ao encaminhar. Não passa do prazo final, a não ser que ele já esteja vencido ou vencendo (aí o painel deixa e destaca). Aparece na lista, na demanda e no percurso, e entra nos Indicadores (% de etapas cumpridas por setor).
- **Anexos:** imagens (comprimidas), PDF, Word, Excel e PowerPoint, até 5 MB cada (comprimidos quando compensa). No pedido, na conversa e nas janelas de encaminhar, concluir e devolver. Para arquivos maiores, use o link do SharePoint/OneDrive.
- **Confirmação automática:** se quem pediu não confirmar nem devolver em 24h (configurável), a rotina confirma e registra na conversa.
- **Gestão › Demandas do setor:** tudo o que o setor enviou, recebeu ou por onde passou, filtrável pela origem; imprime a ata e exporta Excel.

## Avisos

Configuráveis em **Administração › Avisos**: para cada regra, ligar/desligar, quando (horas/dias), para quem (responsável, quem pediu, gerente, executivos/líderes, gerente de quem pediu, acompanhantes, admin) e por onde (e-mail, Teams). Padrão:

| Quando | Quem |
|---|---|
| Demanda nova ou encaminhada | Responsável (urgente: também o gerente) |
| Devolvida ou reaberta | Responsável |
| Concluída, falta confirmar | Quem pediu |
| Alta sem abrir em 4h / urgente em 2h | Responsável (urgente: + gerente) |
| Prazo final vence amanhã (8h do dia útil anterior) | Responsável e gerente |
| Venceu (1º dia) | Responsável e gerente |
| Atrasada há 5 dias | Admin e gerente de quem pediu |
| Prazo da etapa vencendo / vencido | Responsável / + gerente |
| Resumo do dia às 8h | Cada pessoa com pendência |

Assuntos começam com **`[Painel Demandas]`**. A página mostra se a rotina está rodando (última rodada) e a prévia do resumo por e-mail e Teams.

## Limites e cuidados

- **Quem tem o link tem a chave**, e a palavra-chave abre o token com permissão de gravar no repositório. As permissões de perfil valem na tela; o histórico do git registra quem mudou o quê. Para cortar o acesso, troque o token (instalador) e, se precisar, faça uma instalação nova com outra palavra-chave.
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
js/core/avisos.js                  regras, e-mail e Teams dos avisos (usado também pelo Actions)
.github/workflows/avisos.yml       rotina de avisos
.github/avisos/run.mjs             script da rotina
ferramentas/painel_analise.html    painel de análise (abre os JSON exportados)
apresentacao.html                  apresentação do projeto
```
