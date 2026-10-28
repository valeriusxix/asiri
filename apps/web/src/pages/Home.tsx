import { Footer, Logo, NetworkPill } from "../components/Layout";
import { ButtonLink, Icon } from "../components/ui";
import { home as t } from "../copy";

export function Home() {
  return (
    <div className="flex min-h-dvh flex-col bg-ink text-white">
      <header className="mx-auto flex h-14 w-full max-w-[960px] items-center gap-2 px-4">
        <Logo light />
        <NetworkPill dark />
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-[960px] px-4 pb-14 pt-10 sm:pt-16">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-gold">{t.eyebrow}</p>
          <h1 className="mt-4 max-w-[16ch] text-[2.6rem] font-extrabold leading-[1.05] tracking-tight sm:text-6xl">{t.title}</h1>
          <p className="mt-5 max-w-[36ch] text-lg leading-relaxed text-white/75 sm:text-xl">{t.sub}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <ButtonLink to="/donate" size="lg">
              {t.donate}
            </ButtonLink>
            <ButtonLink to="/transparency" size="lg" variant="secondary">
              {t.transparency}
            </ButtonLink>
          </div>

          <div className="mt-12 rounded-3xl bg-white/[0.04] p-5 ring-1 ring-white/10 sm:max-w-md">
            <p className="text-sm font-semibold text-white/60">{t.recipientTitle}</p>
            <ul className="mt-3 space-y-2">
              {t.recipientPoints.map((p) => (
                <li key={p} className="flex items-center gap-2.5 text-[17px]">
                  <span className="flex size-6 items-center justify-center rounded-full bg-gold text-ink">
                    <Icon name="check" className="size-4" />
                  </span>
                  {p}
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-gold">{t.recipientNote}</p>
          </div>
        </section>

        <section className="bg-[#f7f7f5] text-ink">
          <div className="mx-auto max-w-[960px] px-4 py-14">
            <h2 className="text-2xl font-bold tracking-tight">{t.stepsTitle}</h2>
            <ol className="mt-6 grid gap-4 sm:grid-cols-3">
              {t.steps.map((s, i) => (
                <li key={s.title} className="rounded-2xl bg-white p-5 ring-1 ring-black/[0.06]">
                  <span className="flex size-9 items-center justify-center rounded-full bg-ink text-sm font-bold text-gold">{i + 1}</span>
                  <h3 className="mt-4 text-lg font-bold">{s.title}</h3>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-black/65">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-[960px] px-4 py-14">
          <h2 className="text-2xl font-bold tracking-tight">{t.whyTitle}</h2>
          <p className="mt-4 max-w-[40ch] text-xl font-semibold leading-snug text-gold">{t.whyLead}</p>
          <div className="mt-4 max-w-2xl space-y-3 text-[17px] leading-relaxed text-white/75">
            <p>{t.whyBody}</p>
            <p>{t.whyZcash}</p>
          </div>
          <p className="mt-6 text-lg font-bold">{t.whyClose}</p>
          <h3 className="mt-10 text-sm font-semibold uppercase tracking-wider text-white/55">{t.useCasesTitle}</h3>
          <ul className="mt-3 flex flex-wrap gap-2">
            {t.useCases.map((u) => (
              <li key={u} className="rounded-full bg-white/10 px-3.5 py-1.5 text-[15px] text-white/85">
                {u}
              </li>
            ))}
          </ul>
        </section>
      </main>

      <Footer dark />
    </div>
  );
}
