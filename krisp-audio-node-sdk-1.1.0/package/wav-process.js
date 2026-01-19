#!/usr/bin/env node

const fs = require('fs');
const WaveFile = require('wavefile').WaveFile;
const krispAudioSdk = require('krisp-audio-node-sdk');

const { Command } = require('commander');
const program = new Command();

function validateProduct(value) {
    if (!['nc', 'ar', 'accent', 'vad', 'tt'].includes(value)) {
        throw new Error(`Invalid product: ${value}. Must be one of: nc, ar, accent, vad, tt.`);
    }
    return value;
}

program
    .name('krisp-wav-process-app')
    .description('Krisp NodeJS wav audio file processing sample')
    .option('-o, --output-path <path>', 'Path to the output WAV file for NC and Accent, text file for VAD or TT')
    .requiredOption('-i, --input-wav <path>', 'Path to the input WAV file')
    .requiredOption('-m, --model <model>', 'Path to the model file')
    .option('-p, --product <product>', 'Product type: nc (Noise Cancellation), accent (Accent Conversion), vad (Voice Activity Detection), tt (Turn-Taking)', validateProduct, "nc")
    .option('-nsl, --nc-level <number>', 'Noise suppression level for NC product only', '100')
    .option('-d, --frame-duration <number>', 'Input frame duration in ms', '10');

program.parse(process.argv)

const options = program.opts();

const inputWavPath = options.inputWav;
let outputWavPath = options.outputPath;
const modelPath = options.model;
const noiseSuppressionLevel = parseFloat(options.ncLevel);
const product = options.product;
const frameDuration = options.frameDuration;

console.log('Input WAV:', inputWavPath);
console.log('Model:', modelPath);
console.log('Noise suppression level:', noiseSuppressionLevel);
console.log('Frame duration:', frameDuration, 'ms');
console.log('Krisp SDK Product: ', options.product);

function readFileSync(filePath) {
    try {
        const buffer = fs.readFileSync(filePath);
        return buffer;
    }
    catch (err) {
        if (err.code === 'ENOENT') {
            throw new Error(`Error: file at "${filePath}" does not exist.`)
        }
        else if (err.code === 'EACCES') {
            throw new Error(`Error: can't access the "${filePath}".`);
        }
        else {
            throw new Error(`Error: reading "${filePath}" file.`);
        }
    }
}

function readWavFileSync(filePath) {
    const buffer = readFileSync(filePath);
    let wav;
    try {
        wav = new WaveFile(buffer);
    }
    catch (err) {
        throw new Error(`${err}\nError decoding ${filePath} WAV file`);
    }
    if (wav.fmt.numChannels !== 1) {
        throw new Error(`Unsupported number of channels: ${wav.fmt.numChannels}. Only mono is supported.`);
    }
    const sampleRate = wav.fmt.sampleRate;
    const WAV_PCM_TYPE = 1;
    const WAV_FLOAT_TYPE = 3;
    if (wav.fmt.audioFormat == WAV_FLOAT_TYPE && wav.fmt.bitsPerSample == 32) {
        const sampleSize = 4;
        const audioData = wav.data.samples;
        return [audioData, sampleRate, sampleSize, "FLOAT32"];
    }
    else if (wav.fmt.audioFormat == WAV_PCM_TYPE && wav.fmt.bitsPerSample == 16) {
        const sampleSize = 2;
        const audioData = wav.data.samples;
        return [audioData, sampleRate, sampleSize, "PCM16"];
    }
    else {
        throw new Error(`Unsupported WAV format: ${wav.fmt.audioFormat} and depth: ${wav.fmt.bitsPerSample}\nonly PCM16 and FLOAT32 are supported`);
    }
}

function getFrameSize(sampleRate) {
    const FRAME_DURATION_MS = parseInt(frameDuration);
    return Math.floor((FRAME_DURATION_MS / 1000) * sampleRate);
}

function audioDataToWavFile(outputWavPath, processedAudio, sampleRate, sampleType) {
    const processedWav = new WaveFile();
    if (sampleType === "PCM16") {
        const typedSamples = new Int16Array(processedAudio.buffer, processedAudio.byteOffset, processedAudio.length / 2);
        processedWav.fromScratch(1, sampleRate, '16', typedSamples);
    } else if (sampleType === "FLOAT32") {
        const typedSamples = new Float32Array(processedAudio.buffer, processedAudio.byteOffset, processedAudio.length / 4);
        processedWav.fromScratch(1, sampleRate, '32f', typedSamples);
    } else {
        throw new Error("Unsupported sample type");
    }
    fs.writeFileSync(outputWavPath, processedWav.toBuffer());
}

function createKrispProcessor(sampleType, config) {
    switch (sampleType) {
        case "PCM16":
            switch (product) {
                case "nc":
                    return krispAudioSdk.NcInt16.create(config);
                case "ar":
                    return krispAudioSdk.ArInt16.create(config);
                case "vad":
                    return krispAudioSdk.VadInt16.create(config);
                case "tt":
                    return krispAudioSdk.TtInt16.create(config);
                case "accent":
                    return krispAudioSdk.ArInt16.create(config);
            }
            break;
        case "FLOAT32":
            switch (product) {
                case "nc":
                    return krispAudioSdk.NcFloat.create(config);
                case "ar":
                    return krispAudioSdk.ArFloat.create(config);
                case "vad":
                    return krispAudioSdk.VadFloat.create(config);
                case "tt":
                    return krispAudioSdk.TtFloat.create(config);
                case "accent":
                    return krispAudioSdk.ArFloat.create(config);
            }
            break;
        default:
            throw new Error("Unexpected sample type: " + sampleType);
    }
    throw new Error("Unexpected configuration type: " + config);
}

function configureKrispSession(sampleType, sampleRate) {
    try {
        if (!fs.existsSync(modelPath)) {
            throw new Error(`Model file not found: ${modelPath}`);
        }
        const krispSampleRate = getSamplingRate(sampleRate);
        const frameDurationEnum = getFrameDurationEnum(parseInt(frameDuration));
        const absoluteModelPath = fs.realpathSync(modelPath);
        config = {
            inputSampleRate: krispSampleRate,
            inputFrameDuration: frameDurationEnum,
            modelInfo: {
                path: absoluteModelPath
            }
        }
        if (product === "nc" || product === "accent") {
            config.outputSampleRate = krispSampleRate
        }
        console.log('Creating Krisp session with config:', JSON.stringify(config, null, 2));
        let instance = createKrispProcessor(sampleType, config);
        if (!instance) {
            throw new Error("Failed to create Krisp NC instance");
        }
        return instance;
    } catch (error) {
        console.error("Error creating Krisp NC:", error.message);
        throw error;
    }
}

function getSamplingRate(rate) {
    if (typeof rate !== 'number' || !Number.isInteger(rate)) {
        throw new Error('Sampling rate must be an integer.');
    }
    const samplingRateMap = {
        8000: krispAudioSdk.enums.SamplingRate.Sr8000Hz,
        16000: krispAudioSdk.enums.SamplingRate.Sr16000Hz,
        24000: krispAudioSdk.enums.SamplingRate.Sr24000Hz,
        32000: krispAudioSdk.enums.SamplingRate.Sr32000Hz,
        44100: krispAudioSdk.enums.SamplingRate.Sr44100Hz,
        48000: krispAudioSdk.enums.SamplingRate.Sr48000Hz,
        88200: krispAudioSdk.enums.SamplingRate.Sr88200Hz,
        96000: krispAudioSdk.enums.SamplingRate.Sr96000Hz,
    };
    if (!samplingRateMap.hasOwnProperty(rate)) {
        throw new Error(`Unsupported sampling rate: ${rate}. Supported rates: ${Object.keys(samplingRateMap).join(', ')}`
        );
    }
    return samplingRateMap[rate];
}

function getFrameDurationEnum(duration) {
    switch (duration) {
        case 10:
            return krispAudioSdk.enums.FrameDuration.Fd10ms;
        case 15:
            return krispAudioSdk.enums.FrameDuration.Fd15ms;
        case 20:
            return krispAudioSdk.enums.FrameDuration.Fd20ms;
        case 30:
            return krispAudioSdk.enums.FrameDuration.Fd30ms;
        case 32:
            return krispAudioSdk.enums.FrameDuration.Fd32ms;
        default:
            throw new Error(`Unsupported frame duration: ${duration}. Supported durations: 10, 20, 30 ms`);
    }
}

function processAudio(inputWavPath, outputWavPath) {
    const [audioData, sampleRate, sampleSize, sampleType] = readWavFileSync(inputWavPath);
    // Generate output filename if not provided
    if (!outputWavPath) {
        const path = require('path');
        const inputFileName = path.basename(inputWavPath, path.extname(inputWavPath));
        // TODO: fix this path
        outputWavPath = `test/assets/${inputFileName}_nodeSdk_NVC_${frameDuration}ms_${sampleRate}Hz.wav`;
        console.log('Auto-generated output WAV:', outputWavPath);
    }
    const session = configureKrispSession(sampleType, sampleRate);
    const frameSizeInSamples = getFrameSize(sampleRate);
    const frameSizeInBytes = frameSizeInSamples * sampleSize;
    const numberOfFrames = Math.floor(audioData.length / frameSizeInBytes);
    let processedAudio;
    let floatResults;
    if (product === "nc" || product === "accent") {
        processedAudio = Buffer.alloc(numberOfFrames * frameSizeInBytes);
    }
     else if (product === "vad" || product === "tt") {
         floatResults = [];
     }
    for (let i = 0; i < numberOfFrames; i++) {
        const start = i * frameSizeInBytes;
        const end = start + frameSizeInBytes;
        const frame = audioData.subarray(start, end);
        if (product === "nc" || product === "accent") {
            const processedFrame = session.process(frame, noiseSuppressionLevel);
            processedAudio.set(processedFrame, start);
        }
         else if (product === "vad" || product === "tt") {
             const frameResult = session.process(frame);
             floatResults.push(frameResult);
         }
    }
    session.destroy();
    if (product === "nc" || product === "accent") {
        audioDataToWavFile(outputWavPath, processedAudio, sampleRate, sampleType);
    }
     else if (product === "vad" || product === "tt") {
         const output = floatResults.map((value, index) => `Frame ${index}: ${value}`).join('\n');
         fs.writeFileSync(outputWavPath, output);
     }
}

function init() {
    try {
        krispAudioSdk.globalInit("");
        console.log('Krisp Audio SDK initialized successfully');

        processAudio(inputWavPath, outputWavPath);

        krispAudioSdk.globalDestroy();
        console.log('Krisp Audio SDK destroyed successfully');
    } catch (error) {
        console.error(error.message);
        throw error;
    }
}

init();
