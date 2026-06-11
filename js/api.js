/**
 * Mapeia as categorias da API do Open Food Facts para categorias amigáveis do nosso sistema.
 * @param {string} categoriesText - Texto bruto de categorias da API
 * @param {Array<string>} tags - Tags de categoria da API
 * @returns {string} Categoria mapeada
 */
function mapCategory(categoriesText = '', tags = []) {
  const text = (categoriesText + ' ' + tags.join(' ')).toLowerCase();
  
  if (text.match(/(beverage|drink|suco|refrigerante|cerveja|vinho|água|bebida|chá|café|refrigerantes|sucos)/)) {
    return 'Bebidas';
  }
  if (text.match(/(dairy|milk|cheese|yogurt|iogurte|queijo|leite|manteiga|requeijão|laticínios|laticínio)/)) {
    return 'Laticínios';
  }
  if (text.match(/(meat|carne|frango|presunto|salsicha|peixe|frango|bacon|frios|presuntaria)/)) {
    return 'Carnes e Frios';
  }
  if (text.match(/(bakery|bread|pão|bolo|bolacha|biscoito|massas|pasta|macarrão|farinha)/)) {
    return 'Padaria / Massas';
  }
  if (text.match(/(fruit|vegetable|banana|maçã|fruta|legume|hortifrúti|salada|verdura|vegetal)/)) {
    return 'Hortifrúti';
  }
  if (text.match(/(clean|limpeza|detergente|sabão|amaciante|desinfetante|esponja|lavar)/)) {
    return 'Limpeza';
  }
  if (text.match(/(hygiene|soap|shampoo|dentifrice|pasta de dente|sabonete|shampoo|condicionador|desodorante|higiene|beleza|escova)/)) {
    return 'Higiene e Beleza';
  }
  if (text.match(/(snack|sweet|candy|chocolate|doce|sobremesa|salgadinho|petisco)/)) {
    return 'Doces e Snacks';
  }
  
  if (text.match(/(pet|dog|cat|ração|animal|cão|gato|mascote|rações)/)) {
    return 'Pet Shop';
  }
  
  // Categoria padrão
  return 'Mercearia';
}

/**
 * Busca informações do produto pelo código de barras nas APIs públicas do ecossistema Open Facts.
 * Realiza a busca em paralelo nos bancos de alimentos, cosméticos, produtos gerais e pet shop.
 * @param {string} barcode - Código de barras (EAN-13 ou EAN-8)
 * @returns {Promise<Object|null>} Retorna dados estruturados do produto ou null se não encontrado
 */
export async function fetchProductFromAPI(barcode) {
  // Limpa o código de barras
  const cleanBarcode = String(barcode).trim();
  if (!cleanBarcode) return null;

  // Lista de APIs públicas (não exigem chave de acesso)
  const apis = [
    { url: `https://world.openfoodfacts.org/api/v2/product/${cleanBarcode}.json`, type: 'food' },
    { url: `https://world.openbeautyfacts.org/api/v2/product/${cleanBarcode}.json`, type: 'beauty' },
    { url: `https://world.openproductsfacts.org/api/v2/product/${cleanBarcode}.json`, type: 'products' },
    { url: `https://world.openpetfoodfacts.org/api/v2/product/${cleanBarcode}.json`, type: 'pet' }
  ];

  // Executa as requisições em paralelo para máxima velocidade
  const fetchPromises = apis.map(async (api) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 segundos de timeout por API

      const response = await fetch(api.url, {
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) return null;

      const data = await response.json();
      if (data && data.status === 1 && data.product) {
        return { product: data.product, type: api.type };
      }
    } catch (e) {
      // Ignora erro individual (offline ou timeout) para permitir que as outras resolvam
    }
    return null;
  });

  let matchedResult = null;
  try {
    const results = await Promise.all(fetchPromises);
    
    // Encontra o primeiro resultado não nulo retornado por alguma das APIs
    matchedResult = results.find(r => r !== null);

    if (matchedResult) {
      const p = matchedResult.product;
      // Nome do produto (tenta português, depois geral, depois inglês)
      const name = p.product_name_pt || p.product_name || p.product_name_en || '';

      // Se encontramos o nome nas APIs Open Facts, retorna diretamente
      if (name.trim() !== '') {
        const apiType = matchedResult.type;
        const brand = p.brands ? p.brands.split(',')[0].trim() : '';
        const image = p.image_front_url || p.image_url || '';
        
        // Mapeia categoria padrão com base na API que respondeu
        let fallbackCat = 'Mercearia';
        if (apiType === 'beauty') fallbackCat = 'Higiene e Beleza';
        if (apiType === 'products') fallbackCat = 'Limpeza';
        if (apiType === 'pet') fallbackCat = 'Pet Shop';

        const category = mapCategory(p.categories || '', p.categories_tags || []);
        
        // Ajustes finos de categoria caso o mapeamento de texto retorne genérico
        let finalCategory = category;
        if (category === 'Mercearia') {
          finalCategory = fallbackCat;
        }

        return {
          barcode: cleanBarcode,
          name: name.trim(),
          brand: brand,
          category: finalCategory,
          image: image,
          price: 0
        };
      }
    }
  } catch (error) {
    console.error('Erro na consulta paralela de APIs:', error);
  }

  // Se não encontramos nas APIs públicas ou se o nome veio vazio/nulo,
  // tenta a API de redundância Barcode Lookup
  console.log(`Produto ${cleanBarcode} não localizado ou sem nome nas APIs Open Facts. Consultando Barcode Lookup...`);
  const barcodeLookupResult = await fetchFromBarcodeLookup(cleanBarcode);
  if (barcodeLookupResult) {
    return barcodeLookupResult;
  }

  // Se a Barcode Lookup também falhou, tenta a API UPCitemdb como fallback secundário
  console.log(`Produto ${cleanBarcode} não encontrado na Barcode Lookup. Consultando UPCitemdb...`);
  const upcItemDbResult = await fetchFromUPCitemdb(cleanBarcode);
  if (upcItemDbResult) {
    return upcItemDbResult;
  }

  // Se a UPCitemdb também falhou, mas tínhamos um matchedResult parcial no Open Facts,
  // retorna o produto com nome desconhecido como última alternativa
  if (matchedResult) {
    const p = matchedResult.product;
    const apiType = matchedResult.type;
    const brand = p.brands ? p.brands.split(',')[0].trim() : '';
    const image = p.image_front_url || p.image_url || '';
    
    let fallbackCat = 'Mercearia';
    if (apiType === 'beauty') fallbackCat = 'Higiene e Beleza';
    if (apiType === 'products') fallbackCat = 'Limpeza';
    if (apiType === 'pet') fallbackCat = 'Pet Shop';

    const category = mapCategory(p.categories || '', p.categories_tags || []);
    let finalCategory = category;
    if (category === 'Mercearia') {
      finalCategory = fallbackCat;
    }

    return {
      barcode: cleanBarcode,
      name: 'Produto Desconhecido',
      brand: brand,
      category: finalCategory,
      image: image,
      price: 0
    };
  }

  return null;
}

/**
 * Busca informações do produto pela API Barcode Lookup (serviço de redundância).
 * @param {string} barcode - Código de barras
 * @returns {Promise<Object|null>} Retorna dados estruturados do produto ou null se não encontrado
 */
async function fetchFromBarcodeLookup(barcode) {
  const apiKey = 'vgqonwvay9w10ko148fxh2fumo1rpt';
  const url = `https://api.barcodelookup.com/v3/products?barcode=${barcode}&key=${apiKey}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000); // 6 segundos de timeout

    const response = await fetch(url, {
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`Barcode Lookup retornou status: ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (data && Array.isArray(data.products) && data.products.length > 0) {
      const p = data.products[0];
      
      const name = p.title || p.product_name || '';
      const brand = p.brand || '';
      // A API retorna um array de imagens; pegamos a primeira se houver
      const image = Array.isArray(p.images) && p.images.length > 0 ? p.images[0] : '';
      const category = mapCategory(p.category || '');

      return {
        barcode: barcode,
        name: name.trim() || 'Produto Desconhecido',
        brand: brand.trim(),
        category: category,
        image: image,
        price: 0
      };
    }
  } catch (error) {
    console.error('Erro ao consultar Barcode Lookup:', error);
  }

  return null;
}

/**
 * Busca informações do produto pela API trial pública do UPCitemdb (serviço de redundância gratuito sem chave).
 * @param {string} barcode - Código de barras
 * @returns {Promise<Object|null>} Retorna dados estruturados do produto ou null se não encontrado
 */
async function fetchFromUPCitemdb(barcode) {
  const url = `https://api.upcitemdb.com/prod/trial/lookup?upc=${barcode}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000); // 6 segundos de timeout

    const response = await fetch(url, {
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`UPCitemdb retornou status: ${response.status}`);
      return null;
    }

    const data = await response.json();
    if (data && Array.isArray(data.items) && data.items.length > 0) {
      const item = data.items[0];
      
      const name = item.title || '';
      const brand = item.brand || item.publisher || '';
      const image = Array.isArray(item.images) && item.images.length > 0 ? item.images[0] : '';
      const category = mapCategory(item.category || '');

      return {
        barcode: barcode,
        name: name.trim() || 'Produto Desconhecido',
        brand: brand.trim(),
        category: category,
        image: image,
        price: 0
      };
    }
  } catch (error) {
    console.error('Erro ao consultar UPCitemdb:', error);
  }

  return null;
}
