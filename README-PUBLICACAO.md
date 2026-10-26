# Yeti Gelinhos Gourmet — publicação no GitHub Pages

## O que precisa ser configurado

1. Crie um projeto gratuito no Supabase e execute `supabase/schema.sql` no SQL Editor.
2. Cadastre seu usuário no Supabase Authentication. Depois, copie o ID desse usuário e adicione-o em `public.admin_users` pelo Table Editor. Só os usuários nessa tabela podem editar preço e estoque.
3. Em `config.js`, preencha `supabaseUrl` e `supabasePublishableKey` com os dados do projeto Supabase. Use somente a chave publicável (ou a chave anon legada). Nunca coloque a chave `service_role` neste site.
4. Crie um repositório no GitHub e envie os arquivos deste projeto para a raiz dele.
5. Nas configurações do repositório, abra **Pages** e selecione **Deploy from a branch**, branch `main` e pasta `/ (root)`.

O GitHub Pages gratuito exige um repositório público. A loja fica em `https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/` e a administração em `https://SEU-USUARIO.github.io/NOME-DO-REPOSITORIO/admin.html`.

## Administração

A tela `admin.html` não oferece cadastro público. Crie a conta pelo painel do Supabase e inclua o ID dela na tabela `admin_users`. As regras RLS do banco limitam alterações de preço e estoque a esses usuários mesmo que alguém tente acessar a tabela diretamente.

## Arquivos do projeto

- `index.html`: loja e pedidos pelo WhatsApp.
- `admin.html` e `admin.js`: entrada e painel de administração.
- `config.js`: endereço e chave publicável do Supabase.
- `supabase/schema.sql`: tabelas, cardápio inicial e regras de acesso.
- `images/`: fotos e logo usados no site.
## Cálculo automático do frete

A loja aceita entrega em Mauá, Santo André e Ribeirão Pires. O cliente informa o CEP e o número/complemento; o frete é calculado pela distância de ida da rota de carro a partir do CEP de origem 09360470, a R$ 2,00 por quilômetro. A distância é estimada com base nas coordenadas associadas ao CEP, então confirme o valor com o cliente pelo WhatsApp.

Para ativar o cálculo:

1. Crie uma conta no OpenRouteService e gere uma chave de API para rotas.
2. Instale e faça login no Supabase CLI, vincule a pasta do projeto ao seu projeto Supabase e, no diretório que contém supabase/, cadastre os segredos:
   - supabase secrets set ORS_API_KEY=SUA_CHAVE
   - supabase secrets set ORIGIN_CEP=09360470
3. Publique a função: supabase functions deploy calculate-delivery-fee.
4. Preencha supabaseUrl e supabasePublishableKey em config.js e publique os arquivos do site no GitHub Pages.

A chave do OpenRouteService fica apenas nos segredos da função Supabase. Não a coloque em config.js, no site público ou no repositório. A função está configurada para aceitar chamadas sem sessão de usuário porque o formulário é público; compartilhe apenas sua chave publicável do Supabase no site. Se a origem mudar, atualize o segredo ORIGIN_CEP e publique novamente a função.

O cálculo usa o ponto aproximado do CEP para traçar a rota; o número da casa não altera a distância calculada. CEPs sem coordenadas disponíveis não podem receber cotação automática.
