/**
 * Script para manejar la instalación PWA (Progressive Web App) mediante un botón manual.
 * Busca elementos con clase "pwa-install-btn" y les asigna la lógica.
 */
(function() {
  let deferredPrompt;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

  // Interceptar el evento nativo de Android/Chrome
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
  });

  // Esperar a que el DOM cargue para buscar el botón
  function initPwaButton() {
    const installBtns = document.querySelectorAll('.pwa-install-btn');
    if (installBtns.length === 0) return;

    // Si ya está instalada, ocultar los botones (comentado temporalmente para depurar)
    // if (isStandalone) {
    //   installBtns.forEach(btn => btn.style.display = 'none');
    //   return;
    // }

    // Asegurar que los botones sean visibles si no está instalada
    installBtns.forEach(btn => {
      btn.style.display = 'inline-block';
      
      btn.addEventListener('click', async () => {
        if (isIOS) {
          // En iOS mostramos un alert explicativo
          alert('Para instalar en iPhone/iPad:\n\n1. Toca el ícono de Compartir (el cuadrado con la flecha hacia arriba) en la barra de navegación inferior.\n2. Selecciona "Agregar a inicio".');
        } else {
          // En Android/Chrome usamos el prompt nativo si está disponible
          if (deferredPrompt) {
            deferredPrompt.prompt();
            const { outcome } = await deferredPrompt.userChoice;
            if (outcome === 'accepted') {
              installBtns.forEach(b => b.style.display = 'none');
            }
            deferredPrompt = null;
          } else {
          // Fallback si el navegador no soporta beforeinstallprompt pero tampoco es iOS
          alert('Para instalar la App:\n\nSi abriste este link desde WhatsApp o un correo, primero toca los 3 puntitos arriba y elige "Abrir en Chrome".\n\nLuego, en el menú de Chrome, selecciona "Instalar aplicación" o "Agregar a la pantalla principal".');
          }
        }
      });
    });

    // Ocultar los botones si se detecta que la app se instaló exitosamente
    window.addEventListener('appinstalled', () => {
      installBtns.forEach(btn => btn.style.display = 'none');
      deferredPrompt = null;
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPwaButton);
  } else {
    initPwaButton();
  }
})();
