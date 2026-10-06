import type { CvLanguage } from '@cv/shared'

/** The item fields a cleared value is asked about here; the others have an auto question. */
export type ClearedPart =
  | 'projects.name'
  | 'projects.period'
  | 'education.degree'
  | 'education.period'
  | 'certifications.name'
  | 'certifications.issuer'
  | 'certifications.year'
  | 'languages.name'
  | 'languages.level'

type VerifierWording = {
  /** A bullet the source doesn't back, shown with the claim and "Yes, add it" / "No". */
  confirm: string
  /** The one tick-what-applies skills question. */
  multi: string
  /** A field the verifier cleared, asked with the field's label. */
  cleared: string
  labels: Record<ClearedPart, string>
  /** The option after the CEFR levels of a cleared language level. */
  native: string
}

/** CEFR levels: the same in every CV language. */
export const LANGUAGE_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const

/**
 * The wording of the verifier's questions in each CV language, so the answers come back in the
 * language of the CV. Typed by `CvLanguage`: a language added to `@cv/shared` fails the build
 * until it is worded here.
 */
export const VERIFIER_WORDING = {
  en: {
    confirm: 'Your text does not say this. Should it stay in the CV?',
    multi: 'Which of these have you worked with? Only what you tick goes into the CV.',
    cleared: 'Your text does not confirm what was written here. What should it say?',
    labels: {
      'projects.name': 'Project',
      'projects.period': 'Period',
      'education.degree': 'Degree',
      'education.period': 'Period',
      'certifications.name': 'Certificate',
      'certifications.issuer': 'Issuer',
      'certifications.year': 'Year',
      'languages.name': 'Language',
      'languages.level': 'Level',
    },
    native: 'Native',
  },
  uk: {
    confirm: 'У вашому тексті цього немає. Залишити це в резюме?',
    multi: 'З чим із цього ви працювали? У резюме потрапить лише те, що ви позначите.',
    cleared: 'Ваш текст не підтверджує того, що тут було написано. Що має бути тут?',
    labels: {
      'projects.name': 'Проєкт',
      'projects.period': 'Період',
      'education.degree': 'Ступінь',
      'education.period': 'Період',
      'certifications.name': 'Сертифікат',
      'certifications.issuer': 'Ким виданий',
      'certifications.year': 'Рік',
      'languages.name': 'Мова',
      'languages.level': 'Рівень',
    },
    native: 'Рідна',
  },
  pl: {
    confirm: 'Twój tekst tego nie mówi. Czy ma to zostać w CV?',
    multi: 'Z którymi z nich pracowałeś? Do CV trafi tylko to, co zaznaczysz.',
    cleared: 'Twój tekst nie potwierdza tego, co tu było. Co powinno tu być?',
    labels: {
      'projects.name': 'Projekt',
      'projects.period': 'Okres',
      'education.degree': 'Stopień',
      'education.period': 'Okres',
      'certifications.name': 'Certyfikat',
      'certifications.issuer': 'Wystawca',
      'certifications.year': 'Rok',
      'languages.name': 'Język',
      'languages.level': 'Poziom',
    },
    native: 'Ojczysty',
  },
  de: {
    confirm: 'Ihr Text sagt das nicht. Soll es im Lebenslauf bleiben?',
    multi: 'Womit davon haben Sie gearbeitet? Nur was Sie ankreuzen, kommt in den Lebenslauf.',
    cleared: 'Ihr Text bestätigt nicht, was hier stand. Was soll hier stehen?',
    labels: {
      'projects.name': 'Projekt',
      'projects.period': 'Zeitraum',
      'education.degree': 'Abschluss',
      'education.period': 'Zeitraum',
      'certifications.name': 'Zertifikat',
      'certifications.issuer': 'Aussteller',
      'certifications.year': 'Jahr',
      'languages.name': 'Sprache',
      'languages.level': 'Niveau',
    },
    native: 'Muttersprache',
  },
  fr: {
    confirm: 'Votre texte ne dit pas cela. Faut-il le garder dans le CV ?',
    multi: 'Avec lesquels avez-vous travaillé ? Seul ce que vous cochez ira dans le CV.',
    cleared: 'Votre texte ne confirme pas ce qui était écrit ici. Que faut-il mettre ?',
    labels: {
      'projects.name': 'Projet',
      'projects.period': 'Période',
      'education.degree': 'Diplôme',
      'education.period': 'Période',
      'certifications.name': 'Certification',
      'certifications.issuer': 'Organisme',
      'certifications.year': 'Année',
      'languages.name': 'Langue',
      'languages.level': 'Niveau',
    },
    native: 'Langue maternelle',
  },
  es: {
    confirm: 'Tu texto no dice esto. ¿Debe quedarse en el CV?',
    multi: '¿Con cuáles de estos has trabajado? Solo lo que marques irá al CV.',
    cleared: 'Tu texto no confirma lo que había aquí. ¿Qué debería decir?',
    labels: {
      'projects.name': 'Proyecto',
      'projects.period': 'Periodo',
      'education.degree': 'Título',
      'education.period': 'Periodo',
      'certifications.name': 'Certificación',
      'certifications.issuer': 'Emisor',
      'certifications.year': 'Año',
      'languages.name': 'Idioma',
      'languages.level': 'Nivel',
    },
    native: 'Nativo',
  },
} as const satisfies Record<CvLanguage, VerifierWording>
