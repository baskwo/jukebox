import { joinVoiceChannel } from "@discordjs/voice";
import { Message, StageChannel, TextChannel, Util, VoiceChannel, Collection, Snowflake, MessageOptions } from "discord.js";
import { decodeHTML } from "entities";
import { URL } from "url";
import { Client, LiveVideo, MixPlaylist, Playlist, Video, VideoCompact } from "youtubei";
import { images } from "../constants/images";
import { shuffleMode } from "../constants/shuffleMode";
import { BaseCommand } from "../structures/BaseCommand";
import { ServerQueue } from "../structures/ServerQueue";
import { YouTubeTrack } from "../structures/YouTubeTrack";
import { ITrackMetadata } from "../typings";
import { createEmbed, hexColorsType } from "../utils/createEmbed";
import { DefineCommand } from "../utils/decorators/DefineCommand";
import { isSameVoiceChannel, isUserInTheVoiceChannel, isValidVoiceChannel } from "../utils/decorators/MusicHelper";

@DefineCommand({
    aliases: ["play-music", "add", "p"],
    name: "play",
    description: lang => lang.COMMAND_PLAY_META_DESCRIPTION(),
    usage: lang => `{prefix}play <${lang.COMMAND_PLAY_META_ARGS(0)}>`
})
export class PlayCommand extends BaseCommand {
    private readonly youtubeHostnames = ["youtu.be", "youtube.com", "www.youtube.com", "music.youtube.com"];
    private readonly youtube = new Client();
    private readonly playlistAlreadyQueued: Collection<Snowflake, ITrackMetadata[]> = new Collection();

    @isUserInTheVoiceChannel()
    @isValidVoiceChannel()
    @isSameVoiceChannel()
    public async execute(message: Message, args: string[]): Promise<any> {
        const voiceChannel = message.member!.voice.channel!;

        if (!args[0]) {
            return message.channel.send({
                embeds: [createEmbed("error", this.client.lang.COMMAND_INVALID_ARGS(message.client.config.prefix, this.meta.name))]
            });
        }

        const searchString = args.join(" ");
        const parsedUrl = PlayCommand.getURL(searchString);
        // eslint-disable-next-line @typescript-eslint/no-non-null-asserted-optional-chain
        const youtubeURL = this.youtubeHostnames.includes(parsedUrl?.hostname!) ? parsedUrl : undefined;

        if (message.guild!.queue !== null && voiceChannel.id !== message.guild!.queue.voiceChannel?.id) {
            return message.channel.send({
                embeds: [createEmbed("warn", this.client.lang.COMMAND_PLAY_ALREADY_PLAYING(message.guild!.queue.voiceChannel!.name))]
            });
        }

        try {
            let trackResource: LiveVideo | Video | undefined;
            if (parsedUrl) {
                if (youtubeURL) {
                    if (youtubeURL.hostname === "youtu.be") {
                        trackResource = await this.youtube.getVideo(youtubeURL.pathname.slice(1));
                    } else if (youtubeURL.pathname === "/watch" && youtubeURL.searchParams.has("v")) {
                        trackResource = await this.youtube.getVideo(youtubeURL.searchParams.get("v")!);
                        if (youtubeURL.searchParams.has("list")) {
                            const index = Number(youtubeURL.searchParams.get("index") ?? -1);
                            this.loadYouTubePlaylist(youtubeURL.searchParams.get("list")!, message, voiceChannel, true, index)
                                .catch(e => this.client.logger.error(e));
                        }
                    } else if (youtubeURL.pathname === "/playlist" && youtubeURL.searchParams.has("list")) {
                        return await this.loadYouTubePlaylist(youtubeURL.searchParams.get("list")!, message, voiceChannel);
                    } else {
                        return await message.channel.send({
                            embeds: [createEmbed("error", this.client.lang.COMMAND_PLAY_INVALID_YOUTUBE_URL())]
                        });
                    }
                } else {
                    return await message.channel.send({
                        embeds: [createEmbed("error", this.client.lang.COMMAND_PLAY_INVALID_SOURCE())]
                    });
                }
            } else {
                const searchResults = await this.createSearchPrompt(searchString, message);
                if (searchResults === "canceled") return undefined;
                trackResource = searchResults;
            }
            if (trackResource === undefined) {
                return await message.channel.send({
                    embeds: [createEmbed("error", this.client.lang.COMMAND_PLAY_COULD_NOT_RESOLVE_RESOURCE())]
                });
            }
            await this.handleVideo(trackResource, message, voiceChannel);
        } catch (err: unknown) {
            // TODO: Remove this next line if https://github.com/SuspiciousLookingOwl/youtubei/issues/37 is resolved.
            let error = err as Error;
            if (error.message === "Cannot read properties of undefined (reading 'find')") error = new Error(this.client.lang.COMMAND_PLAY_RESOURCE_NOT_FOUND());
            else this.client.logger.error(error);

            message.channel.send({ embeds: [createEmbed("error", this.client.lang.COMMAND_PLAY_RESOURCE_PROCESSING_ERR(error.message))] })
                .catch(e => this.client.logger.error(e));
        }
    }

    private async handleVideo(
        resource: handleVideoResourceType,
        message: Message,
        voiceChannel: StageChannel | VoiceChannel,
        playlist = false,
        restPlaylist = false
    ): Promise<any> {
        // NOTE: handleVideo function can only add YouTube videos, for now.
        let duration = 0;

        if (resource instanceof Video || resource instanceof VideoCompact) {
            duration = resource.duration ?? 0;
        }

        const metadata = {
            id: resource.id,
            thumbnail: resource.thumbnails.best!,
            title: PlayCommand.cleanTitle(resource.title),
            url: PlayCommand.generateYouTubeURL(resource.id, "video"),
            duration
        };
        const addedTrackMsg = (): void => {
            message.channel.send({
                embeds: [createEmbed("info", this.client.lang.COMMAND_PLAY_TRACK_ADDED(metadata.title, metadata.url)).setThumbnail(metadata.thumbnail)]
            }).catch(e => this.client.logger.error(e));
        };
        if (message.guild?.queue) {
            const track = new YouTubeTrack(message.guild.queue, metadata, this.client.config.enableInlineVolume);
            if (!this.client.config.allowDuplicate && message.guild.queue.tracks.find(s => s.metadata.id === metadata.id)) {
                if (playlist) {
                    const playlistAlreadyQueued = this.playlistAlreadyQueued.get(message.guild.id) ?? [];
                    playlistAlreadyQueued.push(metadata);
                    this.playlistAlreadyQueued.set(message.guild.id, playlistAlreadyQueued);
                    return undefined;
                }
                return message.channel.send({
                    embeds: [
                        createEmbed("warn", this.client.lang.COMMAND_PLAY_ALREADY_QUEUED_MSG(metadata.title, metadata.url, message.client.config.prefix))
                            .setTitle(this.client.lang.COMMAND_PLAY_ALREADY_QUEUED_TITLE())
                            .setThumbnail(metadata.thumbnail)
                    ]
                });
            }
            message.guild.queue.tracks.add(track);
            if (!playlist) addedTrackMsg();
        } else {
            if (restPlaylist) return undefined;
            message.guild!.queue = new ServerQueue(this.client, message.guild!, message.channel as TextChannel, voiceChannel);
            const track = new YouTubeTrack(message.guild!.queue, metadata, this.client.config.enableInlineVolume);
            message.guild!.queue.tracks.add(track);
            if (!playlist) addedTrackMsg();
            try {
                const connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: message.guild!.id,
                    // @ts-expect-error Ignore this for now.
                    adapterCreator: message.guild!.voiceAdapterCreator, // TODO: Fix this properly?
                    selfDeaf: true
                });
                message.guild!.queue.connection = connection;
            } catch (err: unknown) {
                message.guild?.queue.tracks.clear();
                message.guild!.queue = null;
                this.client.logger.error(err);
                message.channel.send({ embeds: [createEmbed("error", this.client.lang.COMMAND_PLAY_COULD_NOT_JOIN_VC((err as Error).message))] })
                    .catch(e => this.client.logger.error(e));
                return undefined;
            }
            await message.guild?.queue.play(track);
        }
    }

    private async loadYouTubePlaylist(id: string, message: Message, voiceChannel: StageChannel | VoiceChannel, watchEndpoint = false, index = 1): Promise<any> {
        const playlist = await this.youtube.getPlaylist(id);
        if (playlist === undefined) return message.channel.send({ embeds: [createEmbed("error", this.client.lang.COMMAND_PLAY_YOUTUBE_PLAYLIST_NOT_FOUND())] });
        if (playlist.videoCount === 0) return message.channel.send({ embeds: [createEmbed("error", this.client.lang.COMMAND_PLAY_YOUTUBE_PLAYLIST_EMPTY())] });
        if (playlist instanceof MixPlaylist) {
            return message.channel.send({ embeds: [createEmbed("error", this.client.lang.COMMAND_PLAY_YOUTUBE_RD_PLAYLIST_NOT_SUPPORTED())] });
        }

        const playlistTitle = `**[${playlist.title}](${PlayCommand.generateYouTubeURL(playlist.id, "playlist")})**`;

        let addingPlaylistVideoMessage;
        let successMsg = this.client.lang.COMMAND_PLAY_YOUTUBE_PLAYLIST_SUCCESS(playlistTitle);
        const generateMessage = (msg: string, type: hexColorsType, footer?: string): MessageOptions => {
            const embed = createEmbed(type, msg)
                // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                .setThumbnail(playlist.videos.items[0].thumbnails.best!);

            if (footer) embed.setFooter({ text: footer, iconURL: images.info });
            return { embeds: [embed] };
        };

        if (watchEndpoint) {
            const { metadata } = message.guild!.queue!.tracks.first()!;
            const videoTitle = `**[${metadata.title}](${PlayCommand.generateYouTubeURL(metadata.id, "video")})**`;

            addingPlaylistVideoMessage = await message.channel.send(
                generateMessage(this.client.lang.COMMAND_PLAY_YOUTUBE_PLAYLIST_ADDING_VIDEOS_FROM(videoTitle, playlistTitle), "info")
            );
            successMsg = this.client.lang.COMMAND_PLAY_YOUTUBE_PLAYLIST_SUCCESS2(playlistTitle, videoTitle);
        } else {
            addingPlaylistVideoMessage = await message.channel.send(
                generateMessage(this.client.lang.COMMAND_PLAY_YOUTUBE_PLAYLIST_ADDING_ALL_VIDEOS(playlistTitle), "info")
            );

            // Add the first video first.
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            const firstVideo = await this.youtube.getVideo(playlist.videos.items[0].id);
            if (!firstVideo) {
                await message.channel.send(
                    generateMessage(this.client.lang.COMMAND_PLAY_YOUTUBE_PLAYLIST_ADDING_FIRST_VIDEOS_ERR(playlistTitle), "error")
                );
                return addingPlaylistVideoMessage.delete();
            }
            await this.handleVideo(firstVideo, message, voiceChannel, true, false);
        }

        const videos = await this.loadYouTubePlaylistVideos(playlist, message, index, message.guild!.queue!.tracks.first()!.metadata.id);

        if (!videos) {
            await message.channel.send(
                generateMessage(this.client.lang.COMMAND_PLAY_YOUTUBE_PLAYLIST_ADDING_REST_VIDEOS_ERR(playlistTitle), "error")
            );
            return addingPlaylistVideoMessage.delete();
        }

        const isShuffleMode = message.guild?.queue?.shuffleMode === shuffleMode.on;
        if (isShuffleMode) message.client.util.shuffleArray(videos);

        for (const video of videos) {
            if (message.guild?.queue === null) return addingPlaylistVideoMessage.delete();
            await this.handleVideo(video, message, voiceChannel, true, true);
        }

        const alreadyQueued = this.playlistAlreadyQueued.get(message.guild!.id) ?? [];
        if (alreadyQueued.length !== 0) {
            let num = 1;
            const tracks = alreadyQueued.map(t => `**${num++}.** **[${t.title}](${PlayCommand.generateYouTubeURL(t.id, "video")})**`);
            message.channel.send({
                embeds: [createEmbed("warn", this.client.lang.COMMAND_PLAY_ALREADY_QUEUED_MSG2(alreadyQueued.length, message.client.config.prefix))]
            }).catch(e => this.client.logger.error(e));
            const pages = this.client.util.paginate(tracks.join("\n"));
            let howManyMessage = 0;
            for (const page of pages) {
                howManyMessage++;
                const embed = createEmbed("warn", page as string);
                if (howManyMessage === 1) embed.setTitle(this.client.lang.COMMAND_PLAY_ALREADY_QUEUED_TITLE2());
                await message.channel.send({ embeds: [embed] });
            }
            this.playlistAlreadyQueued.delete(message.guild!.id);
        }

        await message.channel.send(
            generateMessage(
                successMsg,
                "info",
                isShuffleMode ? this.client.lang.COMMAND_PLAY_YOUTUBE_PLAYLIST_SUCCESS_FOOTER(this.client.config.prefix) : undefined
            )
        );
        return addingPlaylistVideoMessage.delete();
    }

    private async loadYouTubePlaylistVideos(playlist: Playlist, message: Message, startIndex: number, currentId: string): Promise<VideoCompact[] | undefined> {
        try {
            await playlist.videos.next(0);
            const videos = playlist.videos.items;
            // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
            if (startIndex === -1) startIndex = videos.findIndex(s => s.id === currentId) + 1;
            return videos.slice(startIndex, videos.length);
        } catch (e: any) {
            this.client.logger.error(e);
            message.channel.send({ embeds: [createEmbed("error", this.client.lang.COMMAND_PLAY_YOUTUBE_PLAYLIST_LOAD_ERR((e as Error).message))] })
                .catch(e2 => this.client.logger.error(e2));
            return undefined;
        }
    }

    private async createSearchPrompt(searchString: string, message: Message): Promise<LiveVideo | Video | "canceled" | undefined> {
        const result = await this.youtube.search(searchString, { type: "video" });
        if (result.estimatedResults === 0) {
            await message.channel.send({ embeds: [createEmbed("warn", this.client.lang.COMMAND_PLAY_YOUTUBE_SEARCH_NO_RESULTS())] });
            return undefined;
        }

        const videos = result.items;
        return this.selectNextVideo(videos, message);
    }

    private async selectNextVideo(videos: VideoCompact[], message: Message, videoIndex = 0): Promise<LiveVideo | Video | "canceled" | undefined> {
        return this.youtube.getVideo(videos[videoIndex].id)
            .catch(err => { // Possible private/doesn't exist/age restricted video
                const error = err as Error;
                this.client.logger.error(error); // log error for traceability
                if (videos.length === videoIndex + 1) { // if last video in search result
                    void message.channel.send({ embeds: [createEmbed("warn", this.client.lang.COMMAND_PLAY_YOUTUBE_SEARCH_NO_RESULTS())] });
                    return undefined;
                }
                return this.selectNextVideo(videos, message, videoIndex + 1);// Pass to the next video from search.
                // eslint-disable-next-line max-lines
            });
    }

    private static cleanTitle(title: string): string {
        return Util.escapeMarkdown(decodeHTML(title));
    }

    private static generateYouTubeURL(id: string, type: "playlist" | "video"): string {
        return type === "video" ? `https://youtube.com/watch?v=${id}` : `https://youtube.com/playlist?list=${id}`;
    }

    private static getURL(string: string): URL | undefined {
        if (!string.startsWith("http://") && !string.startsWith("https://")) return undefined;

        return new URL(string);
    }
}

type handleVideoResourceType = LiveVideo | Video | VideoCompact;
