# Hormicash — Deploy a Firebase Hosting

## Requisitos
- Node.js instalado
- Firebase CLI (`npm install -g firebase-tools`)

## Pasos

### 1. Instalar Firebase CLI (si no lo tienes)
```bash
npm install -g firebase-tools
```

### 2. Loguearte en Firebase
```bash
firebase login
```

### 3. Copiar esta carpeta a tu máquina
Descarga los archivos y pon todo en una carpeta `hormicash-hosting/`:
```
hormicash-hosting/
├── firebase.json
├── .firebaserc
└── public/
    └── index.html
```

### 4. Deploy
```bash
cd hormicash-hosting
firebase deploy --only hosting
```

### 5. Resultado
Tu dashboard quedará live en:
- **https://hormicash.web.app**
- **https://hormicash.firebaseapp.com**

## IMPORTANTE: Autorizar dominio en Firebase Auth
Para que Google Login funcione en el dominio nuevo:

1. Ve a [Firebase Console](https://console.firebase.google.com/project/hormicash/authentication/settings)
2. En **Settings → Authorized domains**
3. Verifica que estén estos dominios:
   - `hormicash.web.app`
   - `hormicash.firebaseapp.com`
   
(Firebase los agrega automáticamente al hacer deploy, pero verifica por si acaso.)

## Nota
El `authDomain` en el HTML ya está configurado como `hormicash.firebaseapp.com`, 
que es compatible con Firebase Hosting. No necesitas cambiar nada en el código.
