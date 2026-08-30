/**
 * SiteFooter — navegación y redes configurables.
 * Ocultar enlaces con visible: false hasta que la ruta exista.
 */
window.FOOTER_CONFIG = {
  brand: {
    href: "/",
    logo: "/assets/Logo Ainspecciona.png",
    alt: "Ainspecciona",
    description:
      "Inteligencia inmobiliaria para documentar, estructurar y conectar la información de cada propiedad.",
    location: "Santiago, Chile",
    email: "contacto@ainspecciona.com"
  },
  footerNavigation: [
    {
      title: "Plataforma",
      links: [
        { label: "Plataforma", href: "/#plataforma", visible: true },
        { label: "Tecnología", href: "/#tecnologia", visible: true },
        { label: "Nosotros", href: "/#equipo", visible: true },
        { label: "Recursos", href: "/faq.html", visible: true }
      ]
    },
    {
      title: "Soluciones",
      links: [
        { label: "Recepción Inmobiliaria", href: "/productos/recepcion-inmobiliaria.html", visible: true },
        { label: "Postventa", href: "/productos/postventa.html", visible: true },
        { label: "Inspección Score", href: "/productos/inspeccion-score.html", visible: true },
        { label: "Inspección Full Check", href: "/productos/inspeccion-full-check.html", visible: true },
        { label: "In & Out", href: "/productos/in-out.html", visible: false },
        { label: "Property Scan", href: "/productos/property-scan.html", visible: false }
      ]
    },
    {
      title: "Acceso y contacto",
      links: [
        { label: "Precios", href: "/precios", visible: false },
        { label: "Iniciar sesión", href: "/app", visible: true },
        { label: "Solicitar demostración", href: "/contacto", visible: true, arrow: true },
        { label: "Contacto", href: "/contacto", visible: true },
        { label: "Soporte", href: "/contacto", visible: true }
      ]
    },
    {
      title: "Legal",
      links: [
        { label: "Términos y condiciones", href: "/terminos", visible: true },
        { label: "Política de privacidad", href: "/privacidad", visible: true },
        { label: "Política de cookies", href: "/cookies", visible: true }
      ]
    }
  ],
  socialLinks: [
    {
      id: "linkedin",
      label: "Ainspecciona en LinkedIn",
      href: "",
      icon: "linkedin"
    },
    {
      id: "instagram",
      label: "Ainspecciona en Instagram",
      href: "",
      icon: "instagram"
    }
  ]
};
