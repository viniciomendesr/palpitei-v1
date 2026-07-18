import type { Lang } from './i18n';

type TeamNames = {
  pt: string;
  en: string;
  aliases?: readonly string[];
};

/**
 * Display names for national teams. TxLINE and the database remain canonical;
 * unknown names are returned unchanged.
 */
const TEAMS: readonly TeamNames[] = [
  { pt: 'África do Sul', en: 'South Africa' },
  { pt: 'Alemanha', en: 'Germany' },
  { pt: 'Arábia Saudita', en: 'Saudi Arabia' },
  { pt: 'Argélia', en: 'Algeria' },
  { pt: 'Argentina', en: 'Argentina' },
  { pt: 'Austrália', en: 'Australia' },
  { pt: 'Áustria', en: 'Austria' },
  { pt: 'Bélgica', en: 'Belgium' },
  { pt: 'Bolívia', en: 'Bolivia' },
  { pt: 'Brasil', en: 'Brazil' },
  { pt: 'Cabo Verde', en: 'Cape Verde' },
  { pt: 'Camarões', en: 'Cameroon' },
  { pt: 'Canadá', en: 'Canada' },
  { pt: 'Catar', en: 'Qatar' },
  { pt: 'Chile', en: 'Chile' },
  { pt: 'China', en: 'China' },
  { pt: 'Colômbia', en: 'Colombia' },
  { pt: 'Coreia do Norte', en: 'North Korea', aliases: ['Korea DPR', 'DPR Korea'] },
  { pt: 'Coreia do Sul', en: 'South Korea', aliases: ['Coreia', 'Korea', 'Korea Republic', 'Republic of Korea'] },
  { pt: 'Costa do Marfim', en: "Côte d'Ivoire", aliases: ['Ivory Coast', 'Cote d Ivoire'] },
  { pt: 'Costa Rica', en: 'Costa Rica' },
  { pt: 'Croácia', en: 'Croatia' },
  { pt: 'Curaçao', en: 'Curaçao', aliases: ['Curacao'] },
  { pt: 'Dinamarca', en: 'Denmark' },
  { pt: 'Egito', en: 'Egypt' },
  { pt: 'Emirados Árabes Unidos', en: 'United Arab Emirates', aliases: ['UAE'] },
  { pt: 'Equador', en: 'Ecuador' },
  { pt: 'Escócia', en: 'Scotland' },
  { pt: 'Eslováquia', en: 'Slovakia' },
  { pt: 'Eslovênia', en: 'Slovenia' },
  { pt: 'Espanha', en: 'Spain' },
  {
    pt: 'Estados Unidos',
    en: 'United States',
    aliases: ['Estados Unidos da América', 'United States of America', 'USA', 'US', 'EUA'],
  },
  { pt: 'França', en: 'France' },
  { pt: 'Gana', en: 'Ghana' },
  { pt: 'Grécia', en: 'Greece' },
  { pt: 'Guiné', en: 'Guinea' },
  { pt: 'Haiti', en: 'Haiti' },
  { pt: 'Holanda', en: 'Netherlands', aliases: ['Países Baixos', 'The Netherlands'] },
  { pt: 'Honduras', en: 'Honduras' },
  { pt: 'Hungria', en: 'Hungary' },
  { pt: 'Inglaterra', en: 'England' },
  { pt: 'Irã', en: 'Iran', aliases: ['IR Iran', 'Iran Islamic Republic'] },
  { pt: 'Irlanda', en: 'Ireland', aliases: ['Republic of Ireland'] },
  { pt: 'Irlanda do Norte', en: 'Northern Ireland' },
  { pt: 'Islândia', en: 'Iceland' },
  { pt: 'Itália', en: 'Italy' },
  { pt: 'Jamaica', en: 'Jamaica' },
  { pt: 'Japão', en: 'Japan' },
  { pt: 'Marrocos', en: 'Morocco' },
  { pt: 'México', en: 'Mexico' },
  { pt: 'Nigéria', en: 'Nigeria' },
  { pt: 'Noruega', en: 'Norway' },
  { pt: 'Nova Zelândia', en: 'New Zealand' },
  { pt: 'Panamá', en: 'Panama' },
  { pt: 'Paraguai', en: 'Paraguay' },
  { pt: 'Peru', en: 'Peru' },
  { pt: 'Polônia', en: 'Poland' },
  { pt: 'Portugal', en: 'Portugal' },
  { pt: 'República Tcheca', en: 'Czechia', aliases: ['Czech Republic'] },
  { pt: 'Romênia', en: 'Romania' },
  { pt: 'Senegal', en: 'Senegal' },
  { pt: 'Sérvia', en: 'Serbia' },
  { pt: 'Suécia', en: 'Sweden' },
  { pt: 'Suíça', en: 'Switzerland' },
  { pt: 'Tunísia', en: 'Tunisia' },
  { pt: 'Turquia', en: 'Türkiye', aliases: ['Turkey', 'Turkiye'] },
  { pt: 'Ucrânia', en: 'Ukraine' },
  { pt: 'Uruguai', en: 'Uruguay' },
  { pt: 'Uzbequistão', en: 'Uzbekistan' },
  { pt: 'Venezuela', en: 'Venezuela' },
  { pt: 'País de Gales', en: 'Wales' },
];

function normalized(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const BY_ALIAS = new Map<string, TeamNames>();
for (const team of TEAMS) {
  for (const alias of [team.pt, team.en, ...(team.aliases ?? [])]) {
    BY_ALIAS.set(normalized(alias), team);
  }
}

/** Localizes a name for display only; never use it before persisting data. */
export function localizeTeamName(name: string, lang: Lang): string {
  const team = BY_ALIAS.get(normalized(name));
  return team?.[lang] ?? name;
}
