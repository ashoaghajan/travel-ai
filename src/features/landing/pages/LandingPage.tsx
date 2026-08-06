import { Link } from 'react-router-dom';
import { ROUTES } from '../../../app/routes';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { Button } from '../../../components/common/Button';
import { Logo } from '../../../components/common/Logo';
import { ArrowRightIcon } from '../../../components/common/icons';
import { FeatureCard } from '../../../components/cards/FeatureCard';
import { LANDING_FEATURES, LANDING_HERO } from '../landing.content';
import heroLandscape from '../../../assets/hero-travel.jpg';
import heroPortrait from '../../../assets/hero-travel-portrait.jpg';
import styles from './LandingPage.module.css';

/**
 * Screen 1 — Landing page (DESIGN_SPEC §8).
 *
 * Full-bleed travel photograph, dark overlay, logo top-left, headline and two
 * calls to action, and three white feature cards near the bottom.
 *
 * Reachable signed in as well as out — by bookmark, by typed URL, or from the
 * auth pages' own brand link — so the calls to action have to know which.
 */
export function LandingPage() {
  // No loading branch, and none should be added: `AuthBootstrap` renders
  // nothing until the session has settled, so this is never read mid-check.
  const { isAuthenticated } = useCurrentUser();

  return (
    <div className={styles.page}>
      <div className={styles.background} aria-hidden="true">
        <picture className={styles.backgroundPicture}>
          {/* Portrait crop keeps the mountain range in frame on phones. */}
          <source media="(max-width: 767px)" srcSet={heroPortrait} />
          <img
            className={styles.backgroundImage}
            src={heroLandscape}
            alt=""
            fetchPriority="high"
            decoding="async"
          />
        </picture>
        <div className={styles.overlay} />
      </div>

      <header className={styles.header}>
        <Link to={ROUTES.landing} className={styles.brandLink} aria-label="AI Travel, home">
          <Logo variant="light" size="lg" />
        </Link>
      </header>

      <main id="main-content" tabIndex={-1} className={styles.main}>
        <section className={styles.hero}>
          <h1 className={styles.headline}>{LANDING_HERO.headline}</h1>

          <p className={styles.subtitle}>
            {LANDING_HERO.subtitleLines.map((line) => (
              <span key={line} className={styles.subtitleLine}>
                {line}
              </span>
            ))}
          </p>

          <div className={styles.actions}>
            {isAuthenticated ? (
              /*
                One way in, because both of the alternatives below lead to an
                account this reader already has. The rest of the page is
                unchanged — it is still worth reading signed in.
              */
              <Button
                to={ROUTES.planner}
                variant="primary"
                size="lg"
                trailingIcon={<ArrowRightIcon size={18} />}
              >
                {LANDING_HERO.authenticatedCta}
              </Button>
            ) : (
              <>
                {/*
                  Both calls to action lead to an account now: the planner is
                  behind the auth boundary, so "Get Started" means "register".
                */}
                <Button
                  to={ROUTES.register}
                  variant="primary"
                  size="lg"
                  trailingIcon={<ArrowRightIcon size={18} />}
                >
                  {LANDING_HERO.primaryCta}
                </Button>
                <Button to={ROUTES.login} variant="glass" size="lg">
                  {LANDING_HERO.secondaryCta}
                </Button>
              </>
            )}
          </div>
        </section>

        <section className={styles.features} aria-labelledby="landing-features-heading">
          <h2 id="landing-features-heading" className="visually-hidden">
            Why plan with AI Travel
          </h2>
          <ul className={styles.featureGrid}>
            {LANDING_FEATURES.map(({ id, title, description, icon: FeatureIcon }) => (
              <FeatureCard
                key={id}
                as="li"
                icon={<FeatureIcon size={22} />}
                title={title}
                description={description}
              />
            ))}
          </ul>
        </section>
      </main>
    </div>
  );
}
