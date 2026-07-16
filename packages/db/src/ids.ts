import { randomUUID } from 'node:crypto';

/**
 * Id legível com prefixo, no formato do v0 ("pred_1a2b3c…").
 *
 * O v0 usava um contador de módulo + 4 caracteres aleatórios. Servia numa
 * bancada em memória; aqui não: o contador zera a cada restart e estes ids
 * agora são CHAVE PRIMÁRIA. Duas instâncias (ou dois deploys) gerariam
 * "pred_1xxxx" as duas — e a colisão só apareceria como um insert perdido.
 *
 * 64 bits de aleatoriedade criptográfica resolvem, e o UNIQUE do banco continua
 * sendo a rede de segurança.
 *
 * Sem `Date.now()` de propósito: ninguém neste sistema deriva tempo do relógio
 * de parede (o tempo vem do ts do evento, via Clock). Um id com timestamp é um
 * convite a alguém "aproveitar" e ordenar por ele.
 */
export function uid(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}
