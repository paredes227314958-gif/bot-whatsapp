const { Client, LocalAuth } = require('whatsapp-web.js');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/run/current-system/sw/bin/chromium',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
        ]
    }
});

const estadoUsuarios = {};

const camiones = {
    'HFSW85': 'Richard Paredes',
    'RXTH24': 'Israel Fuentes',
    'PCTV91': 'XXXX',
    'KBFD31': 'Dany Paredes'
};

client.on('qr', qr => {
    console.log('QR GENERADO - Copia este texto y pégalo en https://webqr.com');
    console.log(qr);
});

client.on('ready', () => {
    console.log('✅ Bot conectado y listo');
});

client.on('message', async msg => {
    const usuario = msg.from;
    const texto = msg.body.trim();
    const textoLower = texto.toLowerCase();

    if (textoLower === 'menu' || textoLower === 'hola' || textoLower === 'inicio') {
        estadoUsuarios[usuario] = { opcion: 'esperando_menu' };
        msg.reply(`👋 Bienvenido! ¿Qué deseas hacer?\n\n1️⃣ Crear cierre\n2️⃣ Crear ruta`);
        return;
    }

    if (estadoUsuarios[usuario]?.opcion === 'esperando_menu') {
        if (texto === '1' || textoLower === 'crear cierre') {
            estadoUsuarios[usuario] = { opcion: 'esperando_camion' };
            msg.reply(`🚛 ¿Qué camión?\n\n1️⃣ HFSW85\n2️⃣ RXTH24\n3️⃣ PCTV91\n4️⃣ KBFD31`);
            return;
        }
        if (texto === '2' || textoLower === 'crear ruta') {
            estadoUsuarios[usuario] = { opcion: 'ruta' };
            msg.reply('🗺️ Perfecto! Envía la foto del informe de carga para generar la ruta.');
            return;
        }
        msg.reply(`⚠️ Opción no válida. Escribe:\n\n1️⃣ Para crear cierre\n2️⃣ Para crear ruta`);
        return;
    }

    if (estadoUsuarios[usuario]?.opcion === 'esperando_camion') {
        const opciones = { '1': 'HFSW85', '2': 'RXTH24', '3': 'PCTV91', '4': 'KBFD31' };
        const patente = opciones[texto] || texto.toUpperCase().trim();
        if (camiones[patente]) {
            estadoUsuarios[usuario] = { opcion: 'cierre', patente: patente, chofer: camiones[patente] };
            msg.reply(`✅ Camión *${patente}* seleccionado.\n📋 Ahora envía la foto de la guía.`);
        } else {
            msg.reply(`⚠️ Opción no válida. Elige uno de estos:\n\n1️⃣ HFSW85\n2️⃣ RXTH24\n3️⃣ PCTV91\n4️⃣ KBFD31`);
        }
        return;
    }

    if (textoLower === 'crear ruta') {
        estadoUsuarios[usuario] = { opcion: 'ruta' };
        msg.reply('🗺️ Perfecto! Envía la foto del informe de carga para generar la ruta.');
        return;
    }

    if (textoLower === 'crear cierre') {
        estadoUsuarios[usuario] = { opcion: 'esperando_camion' };
        msg.reply(`🚛 ¿Qué camión?\n\n1️⃣ HFSW85\n2️⃣ RXTH24\n3️⃣ PCTV91\n4️⃣ KBFD31`);
        return;
    }

    if (msg.hasMedia) {
        const media = await msg.downloadMedia();
        if (!media.mimetype.startsWith('image/')) return;

        if (!estadoUsuarios[usuario]?.opcion || estadoUsuarios[usuario]?.opcion === 'esperando_menu' || estadoUsuarios[usuario]?.opcion === 'esperando_camion') {
            msg.reply(`Por favor primero elige una opción:\n\n1️⃣ Crear cierre\n2️⃣ Crear ruta`);
            return;
        }

        if (estadoUsuarios[usuario].opcion === 'cierre') {
            const patente = estadoUsuarios[usuario].patente;
            const chofer = estadoUsuarios[usuario].chofer;

            try {
                const response = await anthropic.messages.create({
                    model: 'claude-haiku-4-5',
                    max_tokens: 200,
                    messages: [{
                        role: 'user',
                        content: [
                            {
                                type: 'image',
                                source: {
                                    type: 'base64',
                                    media_type: media.mimetype,
                                    data: media.data
                                }
                            },
                            {
                                type: 'text',
                                text: `Analiza esta imagen de una guía de envío de Sodimac.
                                Extrae exactamente estos dos datos:
                                1. El valor que aparece al lado de "Origen:"
                                2. El valor numérico que aparece al lado de "Id.Ruta:"
                                
                                Responde ÚNICAMENTE en este formato JSON exacto, sin texto adicional:
                                {"tienda": "VALOR", "id": "VALOR"}
                                
                                Si no encuentras algún valor, pon "NO_ENCONTRADO" en ese campo.`
                            }
                        ]
                    }]
                });

                const respuestaTexto = response.content[0].text.trim();

                let datos;
                try {
                    const jsonLimpio = respuestaTexto.replace(/```json|```/g, '').trim();
                    datos = JSON.parse(jsonLimpio);
                } catch {
                    msg.reply('⚠️ No pude leer la imagen. Intenta con una foto más clara y nítida.');
                    return;
                }

                if (datos.tienda === 'NO_ENCONTRADO' || datos.id === 'NO_ENCONTRADO') {
                    msg.reply('⚠️ No pude leer la imagen. Intenta con una foto más clara y nítida.');
                    return;
                }

                const mensaje =
`Transporte: Virgen de la puerta
Chofer: ${chofer}
Patente: ${patente}
Tienda: ${datos.tienda}
ID: ${datos.id}
Ruta al 100% ✅`;

                msg.reply(mensaje);

            } catch (error) {
                console.error('Error cierre:', error);
                msg.reply('⚠️ No pude leer la imagen. Intenta con una foto más clara y nítida.');
            }
        }

        if (estadoUsuarios[usuario].opcion === 'ruta') {
            try {
                msg.reply('⏳ Analizando el informe, espera un momento...');

                const responseLectura = await anthropic.messages.create({
                    model: 'claude-haiku-4-5',
                    max_tokens: 3000,
                    messages: [{
                        role: 'user',
                        content: [
                            {
                                type: 'image',
                                source: {
                                    type: 'base64',
                                    media_type: media.mimetype,
                                    data: media.data
                                }
                            },
                            {
                                type: 'text',
                                text: `Lee este documento de Sodimac Chile con mucho cuidado.
                                
                                PASO 1: Identifica cada bloque de reserva en el documento.
                                Cada bloque empieza con "Reserva:" seguido de un número.
                                
                                PASO 2: En cada bloque busca la línea que contiene "Canal:XX" donde XX es un número.
                                En ESA MISMA LÍNEA, después del número de canal, aparece la COMUNA en MAYÚSCULAS.
                                
                                PASO 3: Busca la dirección de entrega. La dirección está en la misma línea que la comuna o inmediatamente después. La dirección tiene:
                                - Nombre de calle (puede ser PASAJE, AVENIDA, CALLE, etc.)
                                - Número (obligatorio)
                                
                                PASO 4: Forma el par COMUNA + DIRECCIÓN para cada reserva.
                                
                                REGLAS ABSOLUTAS:
                                - Solo extrae lo que LITERALMENTE aparece en el documento
                                - NO combines información de diferentes partes
                                - NO incluyas nombres de personas
                                - NO incluyas nombres de productos
                                - NO incluyas SKU ni códigos
                                - Si la imagen está girada, léela en la orientación correcta
                                - Una dirección DEBE tener número, si no tiene número NO la incluyas
                                - NO repitas direcciones
                                - NO inventes nada
                                
                                Responde ÚNICAMENTE con este JSON exacto:
                                {"direcciones": ["COMUNA, CALLE NUMERO, Chile"]}
                                
                                Si no encuentras direcciones válidas: {"direcciones": []}`
                            }
                        ]
                    }]
                });

                const respuestaTexto = responseLectura.content[0].text.trim();

                let datos;
                try {
                    const jsonLimpio = respuestaTexto.replace(/```json|```/g, '').trim();
                    datos = JSON.parse(jsonLimpio);
                } catch {
                    msg.reply('⚠️ No pude leer las direcciones. Intenta con una foto más clara y derecha.');
                    return;
                }

                if (!datos.direcciones || datos.direcciones.length === 0) {
                    msg.reply('⚠️ No encontré direcciones válidas. Asegúrate que la foto esté derecha y nítida.');
                    return;
                }

                const direccionesUnicas = [...new Set(datos.direcciones)];

                const linkCompleto = `https://www.google.com/maps/dir/${direccionesUnicas.map(d => encodeURIComponent(d)).join('/')}`;

                await msg.reply(`🗺️ Ruta generada con ${direccionesUnicas.length} paradas:\n\n🔗 Ver ruta completa:\n${linkCompleto}`);

                for (let i = 0; i < direccionesUnicas.length; i++) {
                    const direccion = direccionesUnicas[i];
                    const linkParada = `https://maps.google.com/?q=${encodeURIComponent(direccion)}`;
                    await msg.reply(`📍 Parada ${i + 1}:\n${direccion}\n🔗 ${linkParada}`);
                }

            } catch (error) {
                console.error('Error ruta:', error);
                msg.reply('⚠️ Ocurrió un error al generar la ruta. Intenta de nuevo.');
            }
        }
    }
});

client.initialize();