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
        { label: "Recursos", href: "/recursos", visible: false }
      ]
    },
    {
      title: "Soluciones",
      links: [
        { label: "Recepción técnica", href: "/entrega", visible: true },
        { label: "Postventa", href: "/postventa/captura", visible: true },
        { label: "Inspección pre-arriendo", href: "/#contacto", visible: true },
        { label: "Inspección pre-venta", href: "/#contacto", visible: true }
      ]
    },
    {
      title: "Acceso y contacto",
      links: [
        { label: "Iniciar sesión", href: "/?login=1", visible: true },
        { label: "Solicitar demostración", href: "/?motivo=demo#contacto", visible: true, arrow: true },
        { label: "Contacto", href: "/#contacto", visible: true },
        { label: "Soporte", href: "mailto:contacto@ainspecciona.com", visible: true }
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
